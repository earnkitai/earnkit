import { prisma } from '../lib/prisma';

async function main() {
  console.log('🌱 Starting database initialization...');

  // Create a sample agent
  const agent = await prisma.agent.upsert({
    where: { agentId: 'agent_123' },
    update: {},
    create: {
      userId: 'user_123',
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

  console.log('🎉 Database initialization completed!');
}

main()
  .catch((e) => {
    console.error('❌ Database initialization failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
