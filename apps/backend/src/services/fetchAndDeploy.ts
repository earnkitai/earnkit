import { ethers } from 'ethers';
import axios from 'axios';
import EarnkitAbis from '../utils/Earnkit.json';

const CONTRACT_ABI: ethers.InterfaceAbi = EarnkitAbis.abi;
const CONTRACT_ADDRESS = '0xYourContractAddress';

const provider = new ethers.JsonRpcProvider(
  'https://base-sepolia.g.alchemy.com/v2/sllQOUylaPM0F9DtUkXe1TxrZ6ueYO1P',
);
const signer = new ethers.Wallet('your_private_key', provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

// Constants
const WETH = '0x4200000000000000000000000000000000000006';
const CAMPAIGN_CONTRACT = '0xCampaignContractAddress';

/**
 * Generate CREATE2 Salt (Ensures deterministic address)
 */
const generateSalt = (name: string, symbol: string): string => {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'string', 'address'],
      [name, symbol, signer.address],
    ),
  );
};

/**
 * Fetch top tokens & deploy them
 */
export const fetchAndDeployTokens = async () => {
  try {
    const { data } = await axios.get(
      'https://frontend-api-v3.pump.fun/coins/for-you?offset=0&limit=1000&includeNsfw=false',
    );

    // Filter tokens with market cap > 20,000
    const filteredTokens = data.filter(
      (token: { usd_market_cap: number }) => token.usd_market_cap > 20000,
    );

    if (filteredTokens.length === 0) {
      console.log('No tokens with market cap > 20000 found.');
      return;
    }

    const selectedTokens = filteredTokens
      .sort(() => 0.5 - Math.random())
      .slice(0, 20);

    console.log(
      'Deploying Tokens:',
      selectedTokens.map((t: { name: any }) => t.name),
    );

    // Deploy each token
    for (const token of selectedTokens) {
      try {
        const salt = generateSalt(token.name, token.symbol);

        const tx = await contract.deployTokenWithCampaigns(
          token.name, // _name
          token.symbol, // _symbol
          ethers.parseUnits('1000000000', 18), // _supply (1B tokens)
          1000, // _fee (UniswapV3 fee)
          salt, // _salt (deterministic)
          signer.address, // _deployer
          Math.floor(Date.now() / 1000), // _fid (timestamp-based)
          token.image_uri, // _image
          '', // _castHash (if available)
          {
            // _poolConfig
            pairedToken: WETH,
            tick: -230400,
            devBuyFee: 10000, // Example fee
          },
          CAMPAIGN_CONTRACT, // campaignContract address
          [], // campaigns array (if applicable)
          10, // campaignPercentage (10% allocated)
        );

        console.log(`Deploying ${token.name}... Transaction Hash:`, tx.hash);
        await tx.wait();
        console.log(`${token.name} deployed successfully.`);
      } catch (error) {
        console.error(
          `Failed to deploy ${token.name}:`,
          (error as Error).message,
        );
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error fetching tokens:', error.message);
    } else {
      console.error('Error fetching tokens:', error);
    }
  }
};

// Call function
fetchAndDeployTokens();
