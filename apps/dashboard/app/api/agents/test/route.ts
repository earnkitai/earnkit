/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { EarnkitAgent, EarnkitToolkit } from 'earnkit';
import { NextResponse } from 'next/server';

// Map to store agent instances by wallet address
const agentInstances = new Map<
  string,
  {
    agent: any;
    config: any;
    lastActive: number;
  }
>();

// Cleanup function to remove inactive agents (optional)
const cleanupInactiveAgents = () => {
  const INACTIVE_THRESHOLD = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();

  for (const [address, instance] of agentInstances.entries()) {
    if (now - instance.lastActive > INACTIVE_THRESHOLD) {
      agentInstances.delete(address);
    }
  }
};

async function initializeAgent(userWalletAddress: `0x${string}`) {
  // Check if agent already exists and is active
  const existingAgent = agentInstances.get(userWalletAddress);
  if (existingAgent) {
    existingAgent.lastActive = Date.now();
    return existingAgent;
  }

  try {
    const llm = new ChatAnthropic({
      modelName: 'claude-3-7-sonnet-20250219',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      temperature: 0.8,
    }) as unknown as BaseChatModel;

    const earnkitAgent = await EarnkitAgent.configureWithWallet({
      network: 'base-sepolia',
      apiKey: process.env.EARNKIT_API_KEY,
      agentName: process.env.EARNKIT_AGENT_NAME,
      pimlicoUrl: process.env.PIMLICO_URL,
      pimlicoApiKey: process.env.PIMLICO_API_KEY,
      apiUrl: process.env.EARNKIT_BACKEND_API_URL || '',
      coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
    });

    const earnkitToolkit = new EarnkitToolkit(earnkitAgent as any);
    const tools = earnkitToolkit.getTools();

    const memory = new MemorySaver();
    const agentConfig = {
      configurable: { thread_id: 'EarnKit Chatbot Example!' },
    };

    const agent = createReactAgent({
      llm,
      tools: tools as any[],
      checkpointSaver: memory,
      messageModifier: `You are a fun and casual blockchain agent.

        When deploying tokens:
        1. DO NOT mention technical details like owner addresses, Basescan, or blockchain specifics
        2. ONLY make fun references and puns related to the token's theme
        3. Keep responses short and entertaining

        The user wallet address which you are using for everytool call is ${userWalletAddress}

        keep your response very short and concise.
        
        Example response for Spiderman token:
        "Spidey sense is tingling! Your SPIDY token just swung into existence! Ready to web-sling through the blockchain!"`,
    });

    // Store the new agent instance
    const agentInstance = {
      agent,
      config: agentConfig,
      lastActive: Date.now(),
    };
    agentInstances.set(userWalletAddress, agentInstance);

    return agentInstance;
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { message, userWalletAddress } = await request.json();

    // Run cleanup occasionally (optional)
    if (Math.random() < 0.1) {
      // 10% chance to run cleanup
      cleanupInactiveAgents();
    }

    // Get or initialize agent
    const agentInstance = await initializeAgent(userWalletAddress);

    // Get streaming response from agent
    const stream = await agentInstance.agent.stream(
      {
        messages: [new HumanMessage(message)],
      },
      agentInstance.config,
    );

    const response = [];

    for await (const chunk of stream) {
      if ('agent' in chunk) {
        const content = chunk.agent.messages[0].content;
        response.push({ responseFrom: 'agent', response: content });
      }
      if ('tools' in chunk) {
        const content = chunk.tools.messages[0].content;
        response.push({
          responseFrom: 'tools',
          response: content,
          tool_name: chunk.tools.messages[0].name,
        });
      }
    }

    // Update last active timestamp
    agentInstance.lastActive = Date.now();

    return NextResponse.json({ response: response });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}
