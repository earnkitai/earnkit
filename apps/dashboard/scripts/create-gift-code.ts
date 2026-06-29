/**
 * One-off CLI to create a gift code directly via Prisma, bypassing the API.
 *
 * Usage (from apps/dashboard):
 *   pnpm exec tsx scripts/create-gift-code.ts <agentId> <credits> [maxRedemptions] [customCode]
 *
 * Examples:
 *   pnpm exec tsx scripts/create-gift-code.ts 7ab75898-375c-4069-b46d-860a7c1f272f 20
 *   pnpm exec tsx scripts/create-gift-code.ts <agentId> 100 50            # capped at 50 redemptions
 *   pnpm exec tsx scripts/create-gift-code.ts <agentId> 50 unlimited MINI20
 */

import 'dotenv/config';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3 || i === 7) out += '-';
  }
  return `EK-${out}`;
}

async function main() {
  const [agentId, creditsStr, maxStr, customRaw] = process.argv.slice(2);

  if (!agentId || !creditsStr) {
    console.error('Usage: tsx scripts/create-gift-code.ts <agentId> <credits> [maxRedemptions|unlimited] [customCode]');
    process.exit(1);
  }

  const credits = parseInt(creditsStr, 10);
  if (!Number.isInteger(credits) || credits <= 0) {
    console.error('credits must be a positive integer');
    process.exit(1);
  }

  let maxRedemptions: number | null = null;
  if (maxStr && maxStr.toLowerCase() !== 'unlimited' && maxStr !== '') {
    const n = parseInt(maxStr, 10);
    if (!Number.isInteger(n) || n <= 0) {
      console.error('maxRedemptions must be a positive integer or "unlimited"');
      process.exit(1);
    }
    maxRedemptions = n;
  }

  const customCode = customRaw ? customRaw.trim().toUpperCase() : '';
  if (customCode && !/^[A-Z0-9_-]{3,32}$/.test(customCode)) {
    console.error('customCode must be 3–32 chars: letters, numbers, dashes, underscores');
    process.exit(1);
  }

  // Accept either the internal UUID (`id`) or the public-facing `agentId`.
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ id: agentId }, { agentId }] },
    select: { id: true, name: true, agentId: true },
  });
  if (!agent) {
    console.error(`Agent not found by id or agentId: ${agentId}`);
    process.exit(1);
  }

  const code = customCode || generateCode();

  try {
    const created = await prisma.giftCode.create({
      data: {
        code,
        agentId: agent.id,
        creditsPerRedemption: credits,
        maxRedemptions,
      },
    });

    console.log('Gift code created:');
    console.log({
      id: created.id,
      code: created.code,
      agent: `${agent.name} (${agent.agentId})`,
      creditsPerRedemption: created.creditsPerRedemption,
      maxRedemptions: created.maxRedemptions ?? 'unlimited',
    });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      console.error(`Code "${code}" already exists. Pick a different custom code.`);
      process.exit(1);
    }
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
