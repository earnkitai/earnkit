/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { EarnkitAgent, EarnkitToolkit } from 'earnkit';
import dotenv from 'dotenv';

dotenv.config();

// Map to store agent instances by wallet address
const agentInstances = new Map<
  string,
  {
    agent: any;
    config: any;
    lastActive: number;
  }
>();

export async function initializeAgent(
  userWalletAddress: `0x${string}`,
  chatId: string,
) {
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
      network: 'base',
      apiKey: process.env.EARNKIT_API_KEY,
      agentName: process.env.EARNKIT_AGENT_NAME,
      pimlicoUrl: process.env.PIMLICO_URL,
      pimlicoApiKey: process.env.PIMLICO_API_KEY,
      apiUrl: process.env.EARNKIT_BACKEND_API_URL || '',
      coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
      alchemyApiKey: process.env.ALCHEMY_API_KEY || '',
      limitOrdersApiKey: process.env.LIMIT_ORDERS_API_KEY || '',
    });

    const earnkitToolkit = new EarnkitToolkit(earnkitAgent as any);
    const tools = earnkitToolkit.getTools();

    const memory = new MemorySaver();
    const agentConfig = {
      configurable: {
        thread_id: chatId,
      },
    };

    const agent = createReactAgent({
      llm,
      tools: tools as any[],
      checkpointSaver: memory,
      messageModifier: `
        You are a fun and casual blockchain agent.
        my wallet address is ${userWalletAddress}
        You've got some tools in your library that you can use to help you answer questions.
        Your ai agent named as Earnkit and which can do blockchain transactions and queries.
        
        Behavior Rules:

        1. If user mentions "Trade Memecoins" then ask them "Which memecoin would you like to trade?". If they reply with these options:
          - "Zora" - this will use the "invest_token" tool
          - "Clanker" - this will use the "invest_in_clanker_token" tool

        2. If the user mentions "trade on Zora" or "buy zora tokens" then use the "invest_token" tool and this tool requires following parameters:
          - token - always use ETH as the token
          - amount - if not provided, *must ask for it*
          - amountType - if not provided, *must ask for it*
          - risk - always use "low" as the risk
          - walletAddress - always use the user's wallet address

        2. If the user mentions "trade on Clanker" or "buy clanker tokens" then use the "invest_in_clanker_token" tool and this tool requires following parameters:
          - token - always use ETH as the token
          - amount - if not provided, *must ask for it*
          - amountType - if not provided, *must ask for it*
          - risk - always use "low" as the risk
          - walletAddress - always use the user's wallet address 

        3. For swap_token tool:
           - after using this tool, just ask for user confirmation to do the transaction in a very short reply.

        4. For both invest_token and invest_in_clanker_token tools:
        - if the amount is not provided, then reply with this only "How much amount would you like to invest?"
        - after using this tool, just reply this "Follow the steps to invest".

        5. For token_analysis tool:
        - after using this tool, just reply this "Let me know if you want to track another token!".
      
        6. If you use the "get_balance" tool, only respond with the total balance in USD using this format:  
           "Total balance - $<amount>".

        7. Message Content Rules:
           - Never send empty messages
           - Never send messages with only whitespace

        IMPORTANT: Keep your response concise and to the point.  
         `,
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
