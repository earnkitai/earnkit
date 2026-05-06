import { ethers, run } from 'hardhat';

async function main() {
  console.log('🚀 Deploying EarnKitEscrow contract to Base...\n');

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log('Deployer address:', deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Deployer balance:', ethers.formatEther(balance), 'ETH\n');

  // Configuration - customize these values
  const PLATFORM_WALLET = process.env.PLATFORM_WALLET || deployer.address;
  const PLATFORM_FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS || '0'); // 20% default

  console.log('Configuration:');
  console.log('  Platform Wallet:', PLATFORM_WALLET);
  console.log('  Platform Fee:', PLATFORM_FEE_BPS / 100, '%\n');

  // Deploy the contract
  console.log('Deploying EarnKitEscrow...');
  const EarnKitEscrow = await ethers.getContractFactory('EarnKitEscrow');
  const escrow = await EarnKitEscrow.deploy(PLATFORM_WALLET, PLATFORM_FEE_BPS);

  await escrow.waitForDeployment();
  const contractAddress = await escrow.getAddress();

  console.log('\n✅ EarnKitEscrow deployed successfully!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Contract Address:', contractAddress);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n📋 Add this to your .env file:');
  console.log(`ESCROW_CONTRACT_ADDRESS=${contractAddress}`);
  console.log('\n📋 Next step - whitelist minidev token:');
  console.log('npx hardhat run scripts/addToken.ts --network base');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Wait for a few block confirmations before verification
  console.log('Waiting for block confirmations...');
  await escrow.deploymentTransaction()?.wait(5);

  // Verify on BaseScan (optional)
  if (process.env.BASESCAN_API_KEY) {
    console.log('\n🔍 Verifying contract on BaseScan...');
    try {
      await run('verify:verify', {
        address: contractAddress,
        constructorArguments: [PLATFORM_WALLET, PLATFORM_FEE_BPS],
      });
      console.log('✅ Contract verified on BaseScan!');
    } catch (error: any) {
      if (error.message.includes('Already Verified')) {
        console.log('Contract is already verified.');
      } else {
        console.log('Verification failed:', error.message);
      }
    }
  } else {
    console.log('\n⚠️  Set BASESCAN_API_KEY in .env to verify contract on BaseScan');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

