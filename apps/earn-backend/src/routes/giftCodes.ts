import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();

/**
 * POST /api/gift-codes/redeem
 * Body: { code, walletAddress, agentId }
 *
 * Atomically validates the code, records the redemption (unique on
 * codeId+wallet prevents the same wallet redeeming twice), bumps the
 * code's redemptionCount, and adds credits to the user's per-agent balance.
 *
 * Express 4 does NOT forward async throws to the errorHandler middleware,
 * so every error path must call `next(error)`. Otherwise the client hangs
 * until its timeout, which then trips the SDK's retry-with-aborted-signal
 * path — see SDK `_apiCall`.
 */
router.post(
  '/redeem',
  validateApiKey,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as { user?: { id: string } }).user?.id;
      if (!userId) throw new AppError('Authentication required', 401);

      const { code, walletAddress, agentId } = req.body as {
        code?: string;
        walletAddress?: string;
        agentId?: string;
      };

      if (!code || typeof code !== 'string') {
        throw new AppError('code is required', 400);
      }
      // Codes are stored uppercase; normalize so end users can type any case.
      const normalizedCode = code.trim().toUpperCase();
      if (!walletAddress || !walletAddress.startsWith('0x')) {
        throw new AppError('walletAddress is required and must start with 0x', 400);
      }
      if (!agentId || typeof agentId !== 'string') {
        throw new AppError('agentId is required', 400);
      }

      const agent = await prisma.agent.findFirst({
        where: { agentId, userId },
        select: { id: true },
      });
      if (!agent) {
        throw new AppError(`Agent with agentId ${agentId} not found`, 404);
      }

      const giftCode = await prisma.giftCode.findUnique({
        where: { code: normalizedCode },
      });
      if (!giftCode || giftCode.agentId !== agent.id) {
        throw new AppError('Invalid gift code', 404);
      }
      if (!giftCode.isActive) {
        throw new AppError('This gift code is no longer active', 400);
      }
      if (giftCode.expiresAt && giftCode.expiresAt < new Date()) {
        throw new AppError('This gift code has expired', 400);
      }
      if (
        giftCode.maxRedemptions !== null &&
        giftCode.redemptionCount >= giftCode.maxRedemptions
      ) {
        throw new AppError('This gift code has been fully redeemed', 400);
      }

      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          await tx.giftCodeRedemption.create({
            data: {
              giftCodeId: giftCode.id,
              userWalletAddress: walletAddress,
              creditsAdded: giftCode.creditsPerRedemption,
            },
          });

          // Conditional increment: only succeeds if we haven't hit maxRedemptions.
          // Prevents races where two concurrent redemptions push the count past the cap.
          if (giftCode.maxRedemptions !== null) {
            const bumped = await tx.giftCode.updateMany({
              where: {
                id: giftCode.id,
                redemptionCount: { lt: giftCode.maxRedemptions },
              },
              data: { redemptionCount: { increment: 1 } },
            });
            if (bumped.count === 0) {
              throw new AppError('This gift code has been fully redeemed', 400);
            }
          } else {
            await tx.giftCode.update({
              where: { id: giftCode.id },
              data: { redemptionCount: { increment: 1 } },
            });
          }

          const balance = await tx.userBalance.upsert({
            where: {
              userWalletAddress_agentId: {
                userWalletAddress: walletAddress,
                agentId: agent.id,
              },
            },
            update: {
              creditBalance: { increment: BigInt(giftCode.creditsPerRedemption) },
            },
            create: {
              userWalletAddress: walletAddress,
              agentId: agent.id,
              creditBalance: BigInt(giftCode.creditsPerRedemption),
              ethBalance: 0,
            },
          });

          return balance;
        });
      } catch (txError: unknown) {
        if (
          typeof txError === 'object' &&
          txError !== null &&
          'code' in txError &&
          (txError as { code?: string }).code === 'P2002'
        ) {
          throw new AppError('This wallet has already redeemed this code', 400);
        }
        throw txError;
      }

      res.json({
        success: true,
        creditsAdded: giftCode.creditsPerRedemption,
        balance: {
          eth: updated.ethBalance.toString(),
          credits: updated.creditBalance.toString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
