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

export async function createLinkedAccounts(
  userId: string,
  linkedAccounts: LinkedAccountWithMetadata[],
) {
  try {
    // Ensure user exists
    await ensureUserExists(userId);

    // Create wallet accounts
    const walletAccounts = linkedAccounts.filter(
      (acc) => acc.type === 'wallet',
    );
    if (walletAccounts.length > 0) {
      await prisma.walletAccount.createMany({
        data: walletAccounts.map((acc) => ({
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

    // Create email accounts
    const emailAccounts = linkedAccounts.filter((acc) => acc.type === 'email');
    if (emailAccounts.length > 0) {
      await prisma.emailAccount.createMany({
        data: emailAccounts.map((acc) => ({
          userId,
          address: acc.address,
        })),
      });
    }

    // Create passkey accounts
    const passkeyAccounts = linkedAccounts.filter(
      (acc) => acc.type === 'passkey',
    );
    if (passkeyAccounts.length > 0) {
      await prisma.passkeyAccount.createMany({
        data: passkeyAccounts.map((acc) => ({
          userId,
          credentialId: acc.credentialId,
          enrolledInMfa: acc.enrolledInMfa || false,
          authenticatorName: acc.authenticatorName || 'unknown',
          createdWithDevice: acc.createdWithDevice || 'unknown',
          createdWithOs: acc.createdWithOs || 'unknown',
          createdWithBrowser: acc.createdWithBrowser || 'unknown',
        })),
      });
    }

    // Create Farcaster accounts
    const farcasterAccounts = linkedAccounts.filter(
      (acc) => acc.type === 'farcaster',
    );
    if (farcasterAccounts.length > 0) {
      await prisma.farcasterAccount.createMany({
        data: farcasterAccounts.map((acc) => ({
          userId,
          fid: acc.fid,
          ownerAddress: acc.ownerAddress,
          username: acc.username,
          displayName: acc.displayName,
          bio: acc.bio,
          pfp: acc.pfp,
          url: acc.url,
          signerPublicKey: acc.signerPublicKey,
        })),
      });
    }

    // Create other social accounts
    const socialAccounts = linkedAccounts.filter((acc) =>
      [
        'google_oauth',
        'twitter_oauth',
        'discord_oauth',
        'github_oauth',
        'spotify_oauth',
        'instagram_oauth',
        'tiktok_oauth',
        'linkedin_oauth',
        'apple_oauth',
        'telegram',
        'phone',
        'smart_wallet',
        'cross_app',
      ].includes(acc.type),
    );

    for (const acc of socialAccounts) {
      switch (acc.type) {
        case 'google_oauth':
          await prisma.googleAccount.create({
            data: {
              userId,
              subject: acc.subject,
              email: acc.email,
              name: acc.name,
            },
          });
          break;
        case 'twitter_oauth':
          await prisma.twitterAccount.create({
            data: {
              userId,
              subject: acc.subject,
              username: acc.username,
              name: acc.name,
              profilePictureUrl: acc.profilePictureUrl,
            },
          });
          break;
        case 'discord_oauth':
          await prisma.discordAccount.create({
            data: {
              userId,
              subject: acc.subject,
              username: acc.username,
              email: acc.email,
            },
          });
          break;
        case 'github_oauth':
          await prisma.githubAccount.create({
            data: {
              userId,
              subject: acc.subject,
              username: acc.username,
              name: acc.name,
              email: acc.email,
            },
          });
          break;
        case 'spotify_oauth':
          await prisma.spotifyAccount.create({
            data: {
              userId,
              subject: acc.subject,
              email: acc.email,
              name: acc.name,
            },
          });
          break;
        case 'instagram_oauth':
          await prisma.instagramAccount.create({
            data: {
              userId,
              subject: acc.subject,
              username: acc.username,
            },
          });
          break;
        case 'tiktok_oauth':
          await prisma.tiktokAccount.create({
            data: {
              userId,
              subject: acc.subject,
              username: acc.username,
              name: acc.name,
            },
          });
          break;
        case 'linkedin_oauth':
          await prisma.linkedInAccount.create({
            data: {
              userId,
              subject: acc.subject,
              name: acc.name,
              email: acc.email,
              vanityName: acc.vanityName,
            },
          });
          break;
        case 'apple_oauth':
          await prisma.appleAccount.create({
            data: {
              userId,
              subject: acc.subject,
              email: acc.email,
            },
          });
          break;
        case 'telegram':
          await prisma.telegramAccount.create({
            data: {
              userId,
              telegramUserId: acc.telegramUserId,
              firstName: acc.firstName,
              lastName: acc.lastName,
              username: acc.username,
              photoUrl: acc.photoUrl,
            },
          });
          break;
        case 'phone':
          await prisma.phoneAccount.create({
            data: {
              userId,
              number: acc.number,
            },
          });
          break;
        case 'smart_wallet':
          await prisma.smartWalletAccount.create({
            data: {
              userId,
              address: acc.address,
              smartWalletType: acc.smartWalletType,
            },
          });
          break;
        case 'cross_app':
          await prisma.crossAppAccount.create({
            data: {
              userId,
              subject: acc.subject,
              providerApp: acc.providerApp
                ? JSON.parse(JSON.stringify(acc.providerApp))
                : null,
            },
          });
          break;
      }
    }

    return true;
  } catch (error) {
    console.error('Error creating linked accounts:', error);
    throw error;
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
 * Syncs a single wallet account (for when a wallet is linked)
 */
export async function addWalletAccount(
  userId: string,
  walletAccount: LinkedAccountWithMetadata,
) {
  try {
    // Ensure this is a wallet account
    if (walletAccount.type !== 'wallet') {
      throw new Error('Invalid account type: expected wallet');
    }

    // Ensure user exists
    await ensureUserExists(userId);

    // Check if wallet already exists
    const existingWallet = await prisma.walletAccount.findFirst({
      where: {
        userId,
        address: walletAccount.address,
      },
    });

    if (existingWallet) {
      return { success: true, message: 'Wallet already exists' };
    }

    // Add the wallet
    await prisma.walletAccount.create({
      data: {
        userId,
        address: walletAccount.address,
        chainType: walletAccount.chainType,
        walletClientType: walletAccount.walletClientType || 'unknown',
        connectorType: walletAccount.connectorType || 'unknown',
        recoveryMethod: walletAccount.recoveryMethod || 'unknown',
        imported: walletAccount.imported ?? false,
        delegated: walletAccount.delegated ?? false,
        walletIndex: walletAccount.walletIndex ?? null,
      },
    });

    return { success: true, message: 'Wallet added successfully' };
  } catch (error) {
    console.error('Error adding wallet account:', error);
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
