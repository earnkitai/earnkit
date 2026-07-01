/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { User, LinkedAccount } from '@/types/user';
import { generateApiKey } from '@/lib/utils';
// import { Prisma } from '@prisma/client';

// Must match the SHA-256 scheme used by earn-backend's ApiKeyService.hashKey().
// Plaintext is shown to the user ONCE on creation; only the hash + prefix are persisted.
function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function prefixOfApiKey(rawKey: string): string {
  // "ek_" (3) + 8 hex chars = 11 — matches earn-backend's prefixOf().
  return rawKey.substring(0, 11);
}

export async function createUser(userData: Partial<User>) {
  const prismaUser = await prisma.user.create({
    data: {
      id: userData.id!,
      username: userData.username,
      email: userData.email,
      hasAcceptedTerms: userData.hasAcceptedTerms || false,
      isGuest: userData.isGuest || false,
      mfaMethods: userData.mfaMethods || [],
    },
    include: {
      walletAccounts: true,
    },
  });

  return transformPrismaUser(prismaUser);
}

export async function findUsernameByUserId(userId: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { id: userId },
  });
  return prismaUser?.username;
}

export async function findUserByUsername(username: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { username },
    include: {
      walletAccounts: true,
    },
  });

  return prismaUser ? transformPrismaUser(prismaUser) : null;
}

export async function findUserById(id: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { id },
    include: {
      walletAccounts: true,
    },
  });

  return prismaUser ? transformPrismaUser(prismaUser) : null;
}

export async function updateUser(id: string, userData: Partial<User>) {
  const prismaUser = await prisma.user.update({
    where: { id },
    data: {
      username: userData.username,
      email: userData.email,
      ...(userData.apiKey !== undefined && { apiKey: userData.apiKey }),
      hasAcceptedTerms: userData.hasAcceptedTerms,
      isGuest: userData.isGuest,
      mfaMethods: userData.mfaMethods,
    },
    include: {
      walletAccounts: true,
    },
  });

  return transformPrismaUser(prismaUser);
}

function transformPrismaUser(prismaUser: any): User {
  return {
    id: prismaUser.id,
    username: prismaUser.username,
    email: prismaUser.email,
    apiKey: prismaUser.apiKey,
    createdAt: prismaUser.createdAt.toISOString(),
    linkedAccounts: transformLinkedAccounts(prismaUser),
    mfaMethods: prismaUser.mfaMethods,
    hasAcceptedTerms: prismaUser.hasAcceptedTerms,
    isGuest: prismaUser.isGuest,
  };
}

function transformLinkedAccounts(prismaUser: any): LinkedAccount[] {
  const accounts: LinkedAccount[] = [];

  if (prismaUser.walletAccounts?.length) {
    accounts.push(
      ...prismaUser.walletAccounts.map((acc: any) => ({
        type: 'wallet',
        id: acc.id,
        address: acc.address,
        chainType: acc.chainType,
        walletClientType: acc.walletClientType,
        connectorType: acc.connectorType,
        recoveryMethod: acc.recoveryMethod,
        imported: acc.imported,
        delegated: acc.delegated,
        walletIndex: acc.walletIndex,
      })),
    );
  }

  return accounts;
}

/**
 * Creates a new API key for a user. The plaintext is returned to the caller
 * exactly once; only the SHA-256 hash and prefix are persisted, so the key
 * cannot be re-displayed later.
 *
 * @param userId - The user ID
 * @returns The plaintext API key (show to user once, then never again)
 */
export async function createApiKey(userId: string): Promise<string> {
  const apiKey = generateApiKey();
  const hash = hashApiKey(apiKey);
  const prefix = prefixOfApiKey(apiKey);

  await prisma.user.update({
    where: { id: userId },
    data: { apiKey: hash, apiKeyPrefix: prefix },
  });

  return apiKey;
}

/**
 * Returns the prefix of the user's API key for display (e.g. "ek_a1b2c3d4").
 * The full plaintext key is unrecoverable after creation — by design.
 *
 * @param userId - The user ID
 * @returns The prefix string for display, or null if no key exists
 */
export async function getApiKey(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { apiKeyPrefix: true, apiKey: true },
  });

  if (!user?.apiKey) return null;
  return user.apiKeyPrefix ?? null;
}

/**
 * Regenerates the user's API key. Invalidates the previous one immediately.
 *
 * @param userId - The user ID
 * @returns The new plaintext API key (show once)
 */
export async function regenerateApiKey(userId: string): Promise<string> {
  return createApiKey(userId);
}

/**
 * Deletes the API key for a user
 * @param userId - The user ID
 */
export async function deleteApiKey(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { apiKey: null, apiKeyPrefix: null },
  });
}

/**
 * Checks if user has an API key
 * @param userId - The user ID
 * @returns true if user has an API key, false otherwise
 */
export async function hasApiKey(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { apiKey: true },
  });

  return !!user?.apiKey;
}
