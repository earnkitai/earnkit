import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  http,
  type TransactionReceipt,
} from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import { campaignAbi, campaignsAbi } from './escrow-abi';

/**
 * Read-only access to the EarnKit escrow contracts (v2.1). The server never signs: it builds
 * transactions for the sponsor's wallet and reads receipts and state.
 */

export type EscrowChain = 'base' | 'base-sepolia' | 'local';
export type TokenInfo = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};
export type RawTx = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: '0';
  chain_id: number;
  description: string;
};

const CHAIN = { base, 'base-sepolia': baseSepolia, local: foundry } as const;

/** Tokens the app offers per chain; the contract's capOf is the real allowlist. */
const TOKENS: Record<Exclude<EscrowChain, 'local'>, TokenInfo[]> = {
  base: [
    {
      symbol: 'USDC',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    },
  ],
  'base-sepolia': [
    {
      symbol: 'USDC',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
    },
  ],
};

export function escrowConfig() {
  const chain = (process.env.ESCROW_CHAIN ?? 'base') as EscrowChain;
  const factory = process.env.ESCROW_FACTORY_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!factory) throw new Error('ESCROW_FACTORY_ADDRESS is not set');
  const tokens =
    chain === 'local'
      ? [
          {
            symbol: 'USDC',
            address: process.env.ESCROW_LOCAL_TOKEN as `0x${string}`,
            decimals: 6,
          },
        ]
      : TOKENS[chain];
  return {
    chain,
    chainId: CHAIN[chain].id,
    factory,
    rpcUrl:
      process.env.ESCROW_RPC_URL ??
      (chain === 'base' ? process.env.BASE_RPC_URL : undefined),
    tokens,
  };
}

export const findToken = (symbol: string) =>
  escrowConfig().tokens.find(
    (t) => t.symbol.toLowerCase() === symbol.trim().toLowerCase(),
  ) ?? null;

function makeClient(c: ReturnType<typeof escrowConfig>) {
  return createPublicClient({
    chain: CHAIN[c.chain],
    transport: http(c.rpcUrl),
  });
}
let client: ReturnType<typeof makeClient> | null = null;
export function escrowClient() {
  const c = escrowConfig();
  client ??= makeClient(c);
  return client;
}

export const capOf = (token: `0x${string}`) =>
  escrowClient().readContract({
    address: escrowConfig().factory,
    abi: campaignsAbi,
    functionName: 'capOf',
    args: [token],
  }) as Promise<bigint>;

const EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};
export const escrowLink = (chainId: number, address: string) =>
  EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${address}` : address;
export const txLink = (chainId: number, hash: string) =>
  EXPLORER[chainId] ? `${EXPLORER[chainId]}/tx/${hash}` : hash;

/** approve + createCampaign, for an agent that holds the sponsor's wallet. */
export function fundTxs(
  ref: `0x${string}`,
  token: TokenInfo,
  amountUnits: bigint,
  endsAt: number,
): RawTx[] {
  const { factory, chainId } = escrowConfig();
  return [
    {
      to: token.address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [factory, amountUnits],
      }),
      value: '0',
      chain_id: chainId,
      description: `Approve the EarnKit escrow factory to take ${token.symbol}`,
    },
    {
      to: factory,
      data: encodeFunctionData({
        abi: campaignsAbi,
        functionName: 'createCampaign',
        args: [ref, token.address, amountUnits, BigInt(endsAt)],
      }),
      value: '0',
      chain_id: chainId,
      description: 'Deposit the pool into a new escrow for this campaign',
    },
  ];
}

export function awardTx(
  escrow: `0x${string}`,
  wallets: string[],
  amountsUnits: bigint[],
): RawTx {
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: campaignAbi,
      functionName: 'award',
      args: [wallets as `0x${string}`[], amountsUnits],
    }),
    value: '0',
    chain_id: escrowConfig().chainId,
    description: 'Pay the winners from escrow (10% fee to EarnKit)',
  };
}

/** The CampaignCreated event in a factory receipt, or null. */
export function readCreated(receipt: TransactionReceipt) {
  const { factory } = escrowConfig();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const e = decodeEventLog({
        abi: campaignsAbi,
        data: log.data,
        topics: log.topics,
      });
      if (e.eventName === 'CampaignCreated') {
        const a = e.args as {
          ref: `0x${string}`;
          sponsor: string;
          campaign: string;
          token: string;
          amount: bigint;
          endsAt: bigint;
        };
        return {
          ref: a.ref,
          sponsor: a.sponsor,
          campaign: a.campaign,
          token: a.token,
          amount: a.amount,
          endsAt: Number(a.endsAt),
        };
      }
    } catch {
      // other events from the factory (CapSet etc.) don't concern us
    }
  }
  return null;
}

/** The Awarded event emitted by `escrow` in a receipt, or null. */
export function readAwarded(receipt: TransactionReceipt, escrow: string) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    try {
      const e = decodeEventLog({
        abi: campaignAbi,
        data: log.data,
        topics: log.topics,
      });
      if (e.eventName === 'Awarded') {
        const a = e.args as {
          winners: string[];
          amounts: bigint[];
          fee: bigint;
        };
        return { winners: [...a.winners], amounts: [...a.amounts], fee: a.fee };
      }
    } catch {
      // not an Awarded log
    }
  }
  return null;
}
