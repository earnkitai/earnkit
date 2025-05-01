/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { prisma } from '@/lib/prisma';
import { User, LinkedAccount } from '@/types/user';
// import { Prisma } from '@prisma/client';

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
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
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

export async function findUserByEmail(email: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { email },
    include: {
      walletAccounts: true,
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
    },
  });

  return prismaUser ? transformPrismaUser(prismaUser) : null;
}

export async function findUserByUsername(username: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { username },
    include: {
      walletAccounts: true,
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
    },
  });

  return prismaUser ? transformPrismaUser(prismaUser) : null;
}

export async function findUserById(id: string) {
  const prismaUser = await prisma.user.findUnique({
    where: { id },
    include: {
      walletAccounts: true,
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
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
      hasAcceptedTerms: userData.hasAcceptedTerms,
      isGuest: userData.isGuest,
      mfaMethods: userData.mfaMethods,
    },
    include: {
      walletAccounts: true,
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
    },
  });

  return transformPrismaUser(prismaUser);
}

export async function deleteUser(id: string) {
  await prisma.user.delete({ where: { id } });
  return true;
}

export async function findAllUsers() {
  const prismaUsers = await prisma.user.findMany({
    include: {
      walletAccounts: true,
      smartWalletAccounts: true,
      emailAccounts: true,
      phoneAccounts: true,
      googleAccounts: true,
      twitterAccounts: true,
      discordAccounts: true,
      githubAccounts: true,
      spotifyAccounts: true,
      instagramAccounts: true,
      tiktokAccounts: true,
      linkedinAccounts: true,
      appleAccounts: true,
      customJwtAccounts: true,
      farcasterAccounts: true,
      passkeyAccounts: true,
      telegramAccounts: true,
      crossAppAccounts: {
        include: {
          embeddedWallets: true,
          smartWallets: true,
        },
      },
    },
  });

  return prismaUsers.map(transformPrismaUser);
}

function transformPrismaUser(prismaUser: any): User {
  return {
    id: prismaUser.id,
    username: prismaUser.username,
    email: prismaUser.email,
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

  if (prismaUser.smartWalletAccounts?.length) {
    accounts.push(
      ...prismaUser.smartWalletAccounts.map((acc: any) => ({
        type: 'smart_wallet',
        address: acc.address,
        smartWalletType: acc.smartWalletType,
      })),
    );
  }

  if (prismaUser.emailAccounts?.length) {
    accounts.push(
      ...prismaUser.emailAccounts.map((acc: any) => ({
        type: 'email',
        address: acc.address,
      })),
    );
  }

  if (prismaUser.phoneAccounts?.length) {
    accounts.push(
      ...prismaUser.phoneAccounts.map((acc: any) => ({
        type: 'phone',
        number: acc.number,
      })),
    );
  }

  if (prismaUser.googleAccounts?.length) {
    accounts.push(
      ...prismaUser.googleAccounts.map((acc: any) => ({
        type: 'google_oauth',
        subject: acc.subject,
        email: acc.email,
        name: acc.name,
      })),
    );
  }

  if (prismaUser.twitterAccounts?.length) {
    accounts.push(
      ...prismaUser.twitterAccounts.map((acc: any) => ({
        type: 'twitter_oauth',
        subject: acc.subject,
        username: acc.username,
        name: acc.name,
        profilePictureUrl: acc.profilePictureUrl,
      })),
    );
  }

  if (prismaUser.discordAccounts?.length) {
    accounts.push(
      ...prismaUser.discordAccounts.map((acc: any) => ({
        type: 'discord_oauth',
        subject: acc.subject,
        username: acc.username,
        email: acc.email,
      })),
    );
  }

  if (prismaUser.githubAccounts?.length) {
    accounts.push(
      ...prismaUser.githubAccounts.map((acc: any) => ({
        type: 'github_oauth',
        subject: acc.subject,
        username: acc.username,
        name: acc.name,
        email: acc.email,
      })),
    );
  }

  if (prismaUser.spotifyAccounts?.length) {
    accounts.push(
      ...prismaUser.spotifyAccounts.map((acc: any) => ({
        type: 'spotify_oauth',
        subject: acc.subject,
        email: acc.email,
        name: acc.name,
      })),
    );
  }

  if (prismaUser.instagramAccounts?.length) {
    accounts.push(
      ...prismaUser.instagramAccounts.map((acc: any) => ({
        type: 'instagram_oauth',
        subject: acc.subject,
        username: acc.username,
      })),
    );
  }

  if (prismaUser.tiktokAccounts?.length) {
    accounts.push(
      ...prismaUser.tiktokAccounts.map((acc: any) => ({
        type: 'tiktok_oauth',
        subject: acc.subject,
        username: acc.username,
        name: acc.name,
      })),
    );
  }

  if (prismaUser.linkedinAccounts?.length) {
    accounts.push(
      ...prismaUser.linkedinAccounts.map((acc: any) => ({
        type: 'linkedin_oauth',
        subject: acc.subject,
        name: acc.name,
        email: acc.email,
        vanityName: acc.vanityName,
      })),
    );
  }

  if (prismaUser.appleAccounts?.length) {
    accounts.push(
      ...prismaUser.appleAccounts.map((acc: any) => ({
        type: 'apple_oauth',
        subject: acc.subject,
        email: acc.email,
      })),
    );
  }

  if (prismaUser.customJwtAccounts?.length) {
    accounts.push(
      ...prismaUser.customJwtAccounts.map((acc: any) => ({
        type: 'custom_auth',
        customUserId: acc.customUserId,
      })),
    );
  }

  if (prismaUser.farcasterAccounts?.length) {
    accounts.push(
      ...prismaUser.farcasterAccounts.map((acc: any) => ({
        type: 'farcaster',
        fid: acc.fid,
        ownerAddress: acc.ownerAddress,
        username: acc.username,
        displayName: acc.displayName,
        bio: acc.bio,
        pfp: acc.pfp,
        url: acc.url,
        signerPublicKey: acc.signerPublicKey,
      })),
    );
  }

  if (prismaUser.passkeyAccounts?.length) {
    accounts.push(
      ...prismaUser.passkeyAccounts.map((acc: any) => ({
        type: 'passkey',
        credentialId: acc.credentialId,
        enrolledInMfa: acc.enrolledInMfa,
        authenticatorName: acc.authenticatorName,
        createdWithDevice: acc.createdWithDevice,
        createdWithOs: acc.createdWithOs,
        createdWithBrowser: acc.createdWithBrowser,
      })),
    );
  }

  if (prismaUser.telegramAccounts?.length) {
    accounts.push(
      ...prismaUser.telegramAccounts.map((acc: any) => ({
        type: 'telegram',
        telegramUserId: acc.telegramUserId,
        firstName: acc.firstName,
        lastName: acc.lastName,
        username: acc.username,
        photoUrl: acc.photoUrl,
      })),
    );
  }

  if (prismaUser.crossAppAccounts?.length) {
    accounts.push(
      ...prismaUser.crossAppAccounts.map((acc: any) => ({
        type: 'cross_app',
        subject: acc.subject,
        providerApp: acc.providerApp as Record<string, any>,
        embeddedWallets: acc.embeddedWallets.map((wallet: any) => ({
          address: wallet.address,
        })),
        smartWallets: acc.smartWallets.map((wallet: any) => ({
          address: wallet.address,
        })),
      })),
    );
  }

  return accounts;
}
