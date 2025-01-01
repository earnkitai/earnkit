export interface IUser {
  userId: string;
  email: string;
  apiKey: string;
  createdAt: Date;
}

export interface IAgent {
  name: string;
  address: string;
}

export interface IWallet {
  userId: string;
  apiKey: string;
  agents: IAgent[];
  walletAddress: string;
  organizationId: string;
  signWith: string;
  createdAt?: Date;
}

export interface SDKConfig {
  turnkeyApiPrivateKey: string;
  turnkeyApiPublicKey: string;
  pimlicoApiKey: string;
  pimlicoUrl: string;
}
