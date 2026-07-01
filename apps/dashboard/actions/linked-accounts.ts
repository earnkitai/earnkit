'use server';

import { prisma } from '@/lib/prisma';
import { LinkedAccountWithMetadata } from '@privy-io/react-auth';

/**
 * Ensures a user exists in the database, creates them if they don't
 */
async function ensureUserExists(userId: string) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!existingUser) {
    await prisma.user.create({
      data: {
        id: userId,
        hasAcceptedTerms: false,
        isGuest: false,
        mfaMethods: [],
      },
    });
  }
}

/**
 * Syncs wallet accounts from Privy to the database
 * This function should be called when wallets are linked/unlinked
 */
export async function syncWalletAccounts(
  userId: string,
  linkedAccounts: LinkedAccountWithMetadata[],
) {
  try {
    // Ensure user exists
    await ensureUserExists(userId);

    // Get current wallet accounts from database
    const existingWallets = await prisma.walletAccount.findMany({
      where: { userId },
      select: { address: true, id: true },
    });

    // Get wallet accounts from Privy
    const privyWallets = linkedAccounts.filter((acc) => acc.type === 'wallet');
    const privyWalletAddresses = privyWallets.map((acc) => acc.address);

    // Find wallets to delete (exist in DB but not in Privy)
    const walletsToDelete = existingWallets.filter(
      (wallet) => !privyWalletAddresses.includes(wallet.address),
    );

    // Find wallets to add (exist in Privy but not in DB)
    const walletsToAdd = privyWallets.filter(
      (wallet) =>
        !existingWallets.some(
          (existing) => existing.address === wallet.address,
        ),
    );

    // Delete removed wallets
    if (walletsToDelete.length > 0) {
      await prisma.walletAccount.deleteMany({
        where: {
          id: { in: walletsToDelete.map((w) => w.id) },
        },
      });
    }

    // Add new wallets
    if (walletsToAdd.length > 0) {
      await prisma.walletAccount.createMany({
        data: walletsToAdd.map((acc) => ({
          userId,
          address: acc.address,
          chainType: acc.chainType,
          walletClientType: acc.walletClientType || 'unknown',
          connectorType: acc.connectorType || 'unknown',
          recoveryMethod: acc.recoveryMethod || 'unknown',
          imported: acc.imported ?? false,
          delegated: acc.delegated ?? false,
          walletIndex: acc.walletIndex ?? null,
        })),
      });
    }

    return {
      added: walletsToAdd.length,
      removed: walletsToDelete.length,
      total: privyWallets.length,
    };
  } catch (error) {
    console.error('Error syncing wallet accounts:', error);
    throw error;
  }
}

/**
 * Removes a wallet account (for when a wallet is unlinked)
 */
export async function removeWalletAccount(userId: string, address: string) {
  try {
    // Check if user exists first
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!existingUser) {
      // If user doesn't exist, there's nothing to remove
      return {
        success: true,
        message: 'User not found, nothing to remove',
        deletedCount: 0,
      };
    }

    const result = await prisma.walletAccount.deleteMany({
      where: {
        userId,
        address,
      },
    });

    return {
      success: true,
      message: 'Wallet removed successfully',
      deletedCount: result.count,
    };
  } catch (error) {
    console.error('Error removing wallet account:', error);
    throw error;
  }
}
