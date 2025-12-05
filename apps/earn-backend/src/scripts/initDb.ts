import { prisma } from '../lib/prisma';
import { randomBytes } from 'crypto';

// Generate a random API key
function generateApiKey(): string {
  return `ek_test_${randomBytes(24).toString('hex')}`;
}

async function main() {
  console.log('🌱 Starting database initialization...');

  // Generate API key for the test user
  const apiKey = generateApiKey();

  // Create a sample user with API key
  const user = await prisma.user.upsert({
    where: { id: 'user_123' },
    update: { apiKey }, // Update API key if user exists
    create: {
      id: 'user_123',
      username: 'test_user',
      email: 'test@earnkit.local',
      apiKey,
      hasAcceptedTerms: true,
      isGuest: false,
    },
  });

  console.log('✅ Created user:', user.id);

  // Create a sample agent
  const agent = await prisma.agent.upsert({
    where: { agentId: 'agent_123' },
    update: {},
    create: {
      userId: user.id,
      name: 'Sample Agent',
      agentId: 'agent_123',
      status: 'ACTIVE',
      feeModel: 'CREDIT_BASED',
      creditsPerPrompt: 1,
      totalEarnings: 0,
    },
  });

  console.log('✅ Created agent:', agent.agentId);

  // Create sample top-up packages
  const packages = await Promise.all([
    prisma.topUpPackage.upsert({
      where: { id: 'package_1' },
      update: {},
      create: {
        id: 'package_1',
        agentId: agent.id,
        name: '10 Credits',
        credits: 10,
        price: 0.001,
        isActive: true,
      },
    }),
    prisma.topUpPackage.upsert({
      where: { id: 'package_2' },
      update: {},
      create: {
        id: 'package_2',
        agentId: agent.id,
        name: '50 Credits',
        credits: 50,
        price: 0.005,
        isActive: true,
      },
    }),
    prisma.topUpPackage.upsert({
      where: { id: 'package_3' },
      update: {},
      create: {
        id: 'package_3',
        agentId: agent.id,
        name: '100 Credits',
        credits: 100,
        price: 0.01,
        isActive: true,
      },
    }),
  ]);

  console.log('✅ Created top-up packages:', packages.length);

  // Create a sample user balance
  const userBalance = await prisma.userBalance.upsert({
    where: {
      userWalletAddress_agentId: {
        userWalletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
        agentId: agent.id,
      },
    },
    update: {},
    create: {
      userWalletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
      agentId: agent.id,
      ethBalance: 0,
      creditBalance: BigInt(100),
    },
  });

  console.log('✅ Created user balance for:', userBalance.userWalletAddress);

  console.log('\n🎉 Database initialization completed!\n');
  
  // Print credentials for agent-backend .env
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 Use these values in your agent-backend/.env file:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`EARNKIT_API_KEY=${apiKey}`);
  console.log(`EARNKIT_AGENT_NAME=${agent.agentId}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Database initialization failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
