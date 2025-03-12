/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { EarnkitAgent, EarnkitToolkit } from 'earnkit';
import { NextResponse } from 'next/server';

const agentInstances = new Map();

async function initializeAgent() {
  try {
    // console.log(config);
    // console.log(toolConfig, "toolConfig");

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
    });

    // const earnkitToolkit = new EarnkitToolkit(earnkitAgent as any);
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

        keep your response very short and concise.
        
        Example response for Spiderman token:
        "Spidey sense is tingling! Your SPIDY token just swung into existence! Ready to web-sling through the blockchain!"`,
    });

    agentInstances.set(process.env.NEXT_PUBLIC_EARNKIT_AGENT_NAME, {
      agent,
      config: { ...agentConfig },
      lastActive: Date.now(),
    });

    return { agent, config: agentConfig };
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { message } = await request.json();
    // Get or initialize agent
    const agentInstance = await initializeAgent();

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
    return NextResponse.json({ response: response });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}
