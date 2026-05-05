import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasApiKey } from '@/actions/user';

interface TopUpPackage {
  id: string;
  credits: string;
  price: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentName,
      agentId,
      feeModel,
      freePromptThreshold,
      ratePerPrompt,
      creditsPerPrompt,
      topUpPackages,
      userId, // This should come from the authenticated user session
      developerWalletAddress,
      buybackAddress,
      buybackPercent,
      // Auto Buyback fields — present iff user opted into auto-swap-and-burn
      // at agent creation. Required as a single block: tokenAddress + thresholdUsd
      // + slippagePercent + buybackPercent. The buybackAddress field is ignored
      // in this mode (we provision a Turnkey wallet and use that instead).
      autoBuyback,
      buybackTokenAddress,
      buybackThresholdUsd,
      buybackSlippagePercent,
    } = body;

    // Validate required fields
    if (!agentName || !feeModel || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }
    if (autoBuyback) {
      if (!buybackTokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(buybackTokenAddress)) {
        return NextResponse.json(
          { error: 'Auto Buyback requires a valid token address' },
          { status: 400 },
        );
      }
      if (!Number.isFinite(Number(buybackThresholdUsd)) || Number(buybackThresholdUsd) <= 0) {
        return NextResponse.json(
          { error: 'Auto Buyback requires a positive thresholdUsd' },
          { status: 400 },
        );
      }
      if (
        !Number.isFinite(Number(buybackSlippagePercent)) ||
        Number(buybackSlippagePercent) < 1 ||
        Number(buybackSlippagePercent) > 20
      ) {
        return NextResponse.json(
          { error: 'Auto Buyback slippage must be between 1% and 20%' },
          { status: 400 },
        );
      }
      if (!buybackPercent || Number(buybackPercent) <= 0 || Number(buybackPercent) > 95) {
        return NextResponse.json(
          { error: 'Auto Buyback requires a buyback percent between 1 and 95' },
          { status: 400 },
        );
      }
      if (!developerWalletAddress) {
        return NextResponse.json(
          { error: 'Auto Buyback requires a developer wallet (used as recovery address)' },
          { status: 400 },
        );
      }
    }

    // Check if user has API key and connected wallets
    const [userHasApiKey] = await Promise.all([hasApiKey(userId)]);

    if (!userHasApiKey) {
      return NextResponse.json(
        {
          error: 'Prerequisites required',
          message:
            'You must complete the required setup before creating an agent.',
          missingPrerequisites: {
            apiKey: !userHasApiKey,
          },
        },
        { status: 400 },
      );
    }

    // Check if agent ID already exists (very unlikely with UUID v4, but good practice)
    const existingAgent = await prisma.agent.findUnique({
      where: { agentId },
    });

    if (existingAgent) {
      return NextResponse.json(
        { error: 'Agent ID already exists' },
        { status: 409 },
      );
    }

    // ─── On-chain provisioning order ────────────────────────────────────────
    // Auto Buyback path:
    //   1. Provision Turnkey sub-org for this agent (returns walletAddress).
    //   2. Deploy Splits using the Turnkey wallet as the buyback recipient.
    //      This is the ONLY ordering that makes Auto Buyback actually work,
    //      because Splits recipients are baked in at deploy and immutable.
    // Static path (legacy / no Auto Buyback):
    //   1. Deploy Splits using the user-provided static buybackAddress.
    //   2. No Turnkey provisioning, no BuybackConfig record.
    // Both paths happen before any DB writes, so a failure mid-way leaves no
    // half-created agent.
    let splitAddress: string | null = null;
    let buybackProvisioning: {
      walletAddress: string;
      subOrgId: string;
      walletId: string;
      policyId: string;
      tokenSymbol: string;
      tokenDecimals: number;
      burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
      tokenAddress: string;
      recoveryAddress: string;
    } | null = null;

    const backendUrl =
      process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';
    const internalSecret = process.env.INTERNAL_API_SECRET;

    if ((autoBuyback || developerWalletAddress) && !internalSecret) {
      return NextResponse.json(
        { error: 'Server misconfiguration: INTERNAL_API_SECRET not set' },
        { status: 500 },
      );
    }

    if (autoBuyback) {
      // Look up the user's email — required as the Turnkey sub-org root authenticator.
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!userRecord?.email) {
        return NextResponse.json(
          {
            error:
              'Auto Buyback requires a verified email on your account (becomes root authenticator on the buyback wallet).',
          },
          { status: 400 },
        );
      }

      const provisionRes = await fetch(
        `${backendUrl}/api/internal/provision-buyback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret as string,
          },
          body: JSON.stringify({
            agentId,
            userEmail: userRecord.email,
            tokenAddress: buybackTokenAddress,
            recoveryAddress: developerWalletAddress,
          }),
        },
      );
      if (!provisionRes.ok) {
        const err = await provisionRes.json().catch(() => ({}));
        console.error('Failed to provision buyback wallet:', err);
        return NextResponse.json(
          { error: err.error || 'Failed to provision buyback wallet' },
          { status: 500 },
        );
      }
      buybackProvisioning = await provisionRes.json();
      console.log(
        `Buyback wallet provisioned: ${buybackProvisioning?.walletAddress} (Turnkey sub-org ${buybackProvisioning?.subOrgId})`,
      );
    }

    if (developerWalletAddress) {
      // Pick the right buyback recipient for the on-chain Splits deploy:
      // - Auto Buyback: the freshly provisioned Turnkey wallet (so the on-chain
      //   split routes future payments directly into the buyback flow).
      // - Static: whatever the user typed in (their cold wallet, etc.).
      const splitBuybackAddress = autoBuyback
        ? buybackProvisioning!.walletAddress
        : buybackAddress || undefined;

      const splitRes = await fetch(
        `${backendUrl}/api/internal/deploy-split`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret as string,
          },
          body: JSON.stringify({
            developerWalletAddress,
            buybackAddress: splitBuybackAddress,
            buybackPercent: buybackPercent ? Number(buybackPercent) : undefined,
          }),
        },
      );

      if (!splitRes.ok) {
        const err = await splitRes.json().catch(() => ({}));
        console.error('Failed to deploy split contract:', err);
        return NextResponse.json(
          { error: err.error || 'Failed to deploy split contract' },
          { status: 500 },
        );
      }

      const splitData = await splitRes.json();
      splitAddress = splitData.splitAddress;
      console.log(`Split deployed at ${splitAddress} for agent ${agentId}`);
    }

    // Create the agent with transaction
    const agent = await prisma.$transaction(async (tx) => {
      // For Auto Buyback agents, the on-chain split is already routing to the
      // Turnkey wallet — store that as Agent.buybackAddress so the existing
      // distribute / withdraw UI shows the right address.
      const persistedBuybackAddress = autoBuyback
        ? buybackProvisioning!.walletAddress
        : buybackAddress || undefined;

      // Create the main agent
      const newAgent = await tx.agent.create({
        data: {
          userId,
          name: agentName,
          agentId,
          status: 'ACTIVE',
          feeModel: feeModel === 'free-tier' ? 'FREE_TIER' : 'CREDIT_BASED',
          freePromptThreshold: freePromptThreshold
            ? parseInt(freePromptThreshold)
            : null,
          ratePerPrompt: ratePerPrompt ? parseFloat(ratePerPrompt) : null,
          creditsPerPrompt: creditsPerPrompt
            ? parseInt(creditsPerPrompt)
            : null,
          totalEarnings: 0,
          splitAddress: splitAddress || undefined,
          buybackAddress: persistedBuybackAddress,
          buybackPercent: buybackPercent ? Number(buybackPercent) : undefined,
        },
      });

      // Create top-up packages if they exist and fee model is credit-based
      if (
        feeModel === 'credit-based' &&
        topUpPackages &&
        topUpPackages.length > 0
      ) {
        const packagesToCreate = topUpPackages
          .filter((pkg: TopUpPackage) => pkg.credits && pkg.price) // Only create packages with valid data
          .map((pkg: TopUpPackage) => ({
            agentId: newAgent.id,
            name: `${pkg.credits} Credits`,
            credits: parseInt(pkg.credits),
            price: parseFloat(pkg.price),
            isActive: true,
          }));

        if (packagesToCreate.length > 0) {
          await tx.topUpPackage.createMany({
            data: packagesToCreate,
          });
        }
      }

      // Persist the BuybackConfig that ties the agent record to its Turnkey
      // wallet + token + threshold. The on-chain split already routes payments
      // to the wallet — this row is just the off-chain metadata the executor
      // worker needs to know what to swap into and when.
      if (autoBuyback && buybackProvisioning) {
        await tx.buybackConfig.create({
          data: {
            agentId: newAgent.id,
            tokenAddress: buybackProvisioning.tokenAddress,
            tokenSymbol: buybackProvisioning.tokenSymbol,
            tokenDecimals: buybackProvisioning.tokenDecimals,
            thresholdUsd: Number(buybackThresholdUsd),
            slippageBps: Math.round(Number(buybackSlippagePercent) * 100),
            burnMode: buybackProvisioning.burnMode,
            turnkeySubOrgId: buybackProvisioning.subOrgId,
            turnkeyWalletId: buybackProvisioning.walletId,
            walletAddress: buybackProvisioning.walletAddress,
            policyId: buybackProvisioning.policyId,
            recoveryAddress: buybackProvisioning.recoveryAddress,
            isActive: true,
          },
        });
      }

      return newAgent;
    });

    return NextResponse.json(
      {
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          agentId: agent.agentId,
          status: agent.status,
          feeModel: agent.feeModel,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    const agents = await prisma.agent.findMany({
      where: {
        userId,
        status: {
          in: ['ACTIVE', 'PAUSED'],
        },
      },
      include: {
        topUpPackages: {
          where: { isActive: true },
        },
        transactionLogs: {
          where: {
            status: 'COMPLETED',
            transactionType: 'EARNING',
          },
          orderBy: { createdAt: 'desc' },
          take: 30, // Get last 30 transactions for graph data
        },
        _count: {
          select: {
            transactionLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
