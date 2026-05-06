'use server';

import { prisma } from '@/lib/prisma';
import { LinkedAccountWithMetadata } from '@privy-io/react-auth';

export async function createLinkedAccounts(
  userId: string,
  linkedAccounts: LinkedAccountWithMetadata[],
) {
  try {
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
          recoveryMethod: acc.recoveryMethod,
          imported: acc.imported,
          delegated: acc.delegated,
          walletIndex: acc.walletIndex,
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
