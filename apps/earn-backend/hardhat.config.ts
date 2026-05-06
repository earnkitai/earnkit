import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  paths: {
    sources: './contract',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // Base Mainnet
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    // Base Sepolia Testnet
    'base-sepolia': {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    // Etherscan V2 uses a single API key (not network-specific)
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || '',
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api/v2',
          browserURL: 'https://basescan.org',
        },
      },
      {
        network: 'base-sepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api/v2',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
};

export default config;

