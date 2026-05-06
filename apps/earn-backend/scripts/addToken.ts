import { ethers } from 'hardhat';

// Minidev token on Base
const MINIDEV_TOKEN_ADDRESS = '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07';

async function main() {
  console.log('🪙 Adding supported token to EarnKitEscrow...\n');

  // Get contract address from environment
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error('ESCROW_CONTRACT_ADDRESS not set in environment');
  }

  console.log('Contract Address:', contractAddress);
  console.log('Token to whitelist:', MINIDEV_TOKEN_ADDRESS);

  // Get the signer
  const [signer] = await ethers.getSigners();
  console.log('Signer address:', signer.address, '\n');

  // Get the contract instance
  const EarnKitEscrow = await ethers.getContractFactory('EarnKitEscrow');
  const escrow = EarnKitEscrow.attach(contractAddress);

  // Check if already supported
  const isSupported = await escrow.isTokenSupported(MINIDEV_TOKEN_ADDRESS);
  if (isSupported) {
    console.log('✅ Token is already whitelisted!');
    return;
  }

  // Check owner
  const owner = await escrow.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the owner. Owner: ${owner}, Signer: ${signer.address}`);
  }

  // Add the token
  console.log('Adding MINIDEV token to whitelist...');
  const tx = await escrow.addSupportedToken(MINIDEV_TOKEN_ADDRESS);
  console.log('Transaction hash:', tx.hash);
  
  console.log('Waiting for confirmation...');
  await tx.wait();

  // Verify it was added
  const nowSupported = await escrow.isTokenSupported(MINIDEV_TOKEN_ADDRESS);
  if (nowSupported) {
    console.log('\n✅ MINIDEV token successfully whitelisted!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Token Address:', MINIDEV_TOKEN_ADDRESS);
    console.log('Contract:', contractAddress);
    console.log('═══════════════════════════════════════════════════════════\n');
  } else {
    console.log('❌ Token whitelisting may have failed. Please check the transaction.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

