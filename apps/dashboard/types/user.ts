/* eslint-disable @typescript-eslint/no-explicit-any */
export type ChainType = 'ethereum' | 'solana';
export type WalletClientType = 'privy' | string;
export type RecoveryMethod = 'privy' | string;
export type SmartWalletType = string;
export type ConnectorType = string;
export type AuthenticatorName = string;
export type ProviderAppMetadata = Record<string, any>;

interface LinkedAccountBase {
  type: string;
}

export interface WalletAccount extends LinkedAccountBase {
  type: 'wallet';
  id: string | null;
  address: string;
  chainType: ChainType;
  walletClientType: WalletClientType;
  connectorType: ConnectorType;
  recoveryMethod: RecoveryMethod;
  imported: boolean;
  delegated: boolean;
  walletIndex: number | null;
}

export interface SmartWalletAccount extends LinkedAccountBase {
  type: 'smart_wallet';
  address: string;
  smartWalletType: SmartWalletType;
}

export interface EmailAccount extends LinkedAccountBase {
  type: 'email';
  address: string;
}

export interface PhoneAccount extends LinkedAccountBase {
  type: 'phone';
  number: string;
}

export interface GoogleAccount extends LinkedAccountBase {
  type: 'google_oauth';
  subject: string;
  email: string;
  name: string | null;
}

export interface TwitterAccount extends LinkedAccountBase {
  type: 'twitter_oauth';
  subject: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
}

export interface DiscordAccount extends LinkedAccountBase {
  type: 'discord_oauth';
  subject: string;
  username: string | null;
  email: string | null;
}

export interface GithubAccount extends LinkedAccountBase {
  type: 'github_oauth';
  subject: string;
  username: string | null;
  name: string | null;
  email: string | null;
}

export interface SpotifyAccount extends LinkedAccountBase {
  type: 'spotify_oauth';
  subject: string;
  email: string | null;
  name: string | null;
}

export interface InstagramAccount extends LinkedAccountBase {
  type: 'instagram_oauth';
  subject: string;
  username: string | null;
}

export interface TiktokAccount extends LinkedAccountBase {
  type: 'tiktok_oauth';
  subject: string;
  username: string | null;
  name: string | null;
}

export interface LinkedInAccount extends LinkedAccountBase {
  type: 'linkedin_oauth';
  subject: string;
  name: string | null;
  email: string | null;
  vanityName: string | null;
}

export interface AppleAccount extends LinkedAccountBase {
  type: 'apple_oauth';
  subject: string;
  email: string;
}

export interface CustomJwtAccount extends LinkedAccountBase {
  type: 'custom_auth';
  customUserId: string;
}

export interface FarcasterAccount extends LinkedAccountBase {
  type: 'farcaster';
  fid: number | null;
  ownerAddress: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  pfp: string | null;
  url: string | null;
  signerPublicKey: string | null;
}

export interface PasskeyAccount extends LinkedAccountBase {
  type: 'passkey';
  credentialId: string;
  enrolledInMfa: boolean;
  authenticatorName: AuthenticatorName;
  createdWithDevice: string;
  createdWithOs: string;
  createdWithBrowser: string;
}

export interface TelegramAccount extends LinkedAccountBase {
  type: 'telegram';
  telegramUserId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface CrossAppAccount extends LinkedAccountBase {
  type: 'cross_app';
  embeddedWallets: { address: string }[];
  smartWallets: { address: string }[];
  providerApp: ProviderAppMetadata;
  subject: string;
}

export type LinkedAccount =
  | WalletAccount
  | SmartWalletAccount
  | EmailAccount
  | PhoneAccount
  | GoogleAccount
  | TwitterAccount
  | DiscordAccount
  | GithubAccount
  | SpotifyAccount
  | InstagramAccount
  | TiktokAccount
  | LinkedInAccount
  | AppleAccount
  | CustomJwtAccount
  | FarcasterAccount
  | PasskeyAccount
  | TelegramAccount
  | CrossAppAccount;

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt: string;
  linkedAccounts?: LinkedAccount[];
  mfaMethods: string[];
  hasAcceptedTerms: boolean;
  isGuest: boolean;
}
