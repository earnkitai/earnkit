import { TurnkeyApiTypes, Turnkey } from '@turnkey/sdk-browser';
import { Address } from 'viem';

export type Attestation = TurnkeyApiTypes['v1Attestation'];

export type Email = `${string}@${string}.${string}`;

export interface Account
  extends Omit<
    TurnkeyApiTypes['v1GetWalletAccountsResponse']['accounts'][number],
    'address' | 'addressFormat'
  > {
  address: Address;
  balance?: {
    ethBalance: bigint;
    baseBalance: bigint;
  };
}

export type Wallet =
  TurnkeyApiTypes['v1GetWalletsResponse']['wallets'][number] & {
    accounts: Account[];
  };

export type PreferredWallet = {
  userId: string;
  walletId: string;
};

export type User = Awaited<ReturnType<Turnkey['getCurrentUser']>> & {
  email?: Email;
  organization?: {
    organizationId: string;
  };
};

export type Authenticator =
  TurnkeyApiTypes['v1GetAuthenticatorsResponse']['authenticators'][number];

export type ReadOnlySession = {
  session: string;
  sessionExpiry: number;
};

export type OauthProviderParams = TurnkeyApiTypes['v1OauthProviderParams'];
