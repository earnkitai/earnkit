import { Socket } from 'socket.io';
import { HumanMessage } from '@langchain/core/messages';
import { initializeAgent } from './initializeAgent';
import { getRedisClient } from '../redis';

export function handleSocketConnection(socket: Socket) {
  console.log('Setting up socket handlers for client:', socket.id);

  // Handle ping messages
  socket.on('ping', (data) => {
    console.log('Received ping from client:', socket.id, data);
    socket.emit('pong', { timestamp: Date.now(), received: data.timestamp });
  });

  socket.on('message', async (data) => {
    console.log('Received message from client:', socket.id, data);
    try {
      const { message, userWalletAddress, chatId } = data;

      if (!message) {
        console.error('No message provided');
        socket.emit('error', { message: 'No message provided' });
        return;
      }

      // Store message in Redis for persistence
      try {
        const redis = getRedisClient();
        const messageKey = `chat:${chatId}:messages`;
        await redis.lpush(
          messageKey,
          JSON.stringify({
            content: message,
            responseFrom: 'user',
            timestamp: Date.now(),
          }),
        );
        console.log('Message stored in Redis');
      } catch (redisError) {
        console.error('Redis error:', redisError);
        // Continue processing even if Redis fails
      }

      // Initialize agent
      console.log('Initializing agent for chat:', chatId);

      const agentInstance = await initializeAgent(userWalletAddress, chatId);
      console.log('Agent initialized successfully');

      // Stream agent response
      console.log('Starting agent stream');
      console.log('Message being sent to agent:', {
        message,
        type: typeof message,
        length: typeof message === 'string' ? message.length : 'N/A',
      });

      // Ensure message is not empty before sending
      if (
        !message ||
        (typeof message === 'string' && message.trim().length === 0)
      ) {
        console.error('Empty message detected, skipping agent stream');
        socket.emit('error', { message: 'Empty message detected' });
        return;
      }

      const stream = await agentInstance.agent.stream(
        {
          messages: [new HumanMessage(message)],
        },
        agentInstance.config,
      );

      let hasResponse = false;
      const responses = [];

      for await (const chunk of stream) {
        hasResponse = true;

        if ('agent' in chunk) {
          const content = chunk.agent.messages[0].content;
          console.log('Agent chunk received:', {
            content,
            type: typeof content,
            isArray: Array.isArray(content),
            length:
              typeof content === 'string'
                ? content.length
                : Array.isArray(content)
                  ? content.length
                  : 'N/A',
          });
          console.log(
            'Agent response:',
            typeof content === 'string'
              ? content.substring(0, 50) + '...'
              : JSON.stringify(content).substring(0, 50) + '...',
          );

          // Format response to match API route format
          console.log('content checking.....');
          console.log(content, 'content');

          // if content is array then it should not be empty but if it is string then it should not be empty
          if (
            (typeof content === 'string' && content.length > 0) ||
            (Array.isArray(content) && content.length > 0)
          ) {
            console.log('content is not empty', content);
            const formattedResponse = {
              responseFrom: 'agent',
              response: content,
            };

            // Add to responses array
            responses.push(formattedResponse);

            // Emit to client
            socket.emit('response', formattedResponse);

            // Store agent response in Redis
            try {
              const redis = getRedisClient();
              const messageKey = `chat:${chatId}:messages`;
              await redis.lpush(
                messageKey,
                JSON.stringify({
                  content,
                  responseFrom: 'agent',
                  timestamp: Date.now(),
                }),
              );
            } catch (redisError) {
              console.error('Redis error storing agent response:', redisError);
            }
          }
        }

        if ('tools' in chunk) {
          const content = chunk.tools.messages[0].content;
          const toolName = chunk.tools.messages[0].name;
          console.log(
            'Tool response:',
            toolName,
            typeof content === 'string'
              ? content.substring(0, 50) + '...'
              : JSON.stringify(content).substring(0, 50) + '...',
          );

          console.log('content checking in tools.....');
          console.log(content, 'content in tools');

          if (
            (typeof content === 'string' && content.length > 0) ||
            (Array.isArray(content) && content.length > 0)
          ) {
            console.log('content is not empty in tools', content);
            // Format response to match API route format
            const formattedResponse = {
              responseFrom: 'tools',
              response: content,
              tool_name: toolName,
            };

            // Add to responses array
            responses.push(formattedResponse);

            // Emit to client
            socket.emit('response', formattedResponse);

            // Store tool response in Redis
            try {
              const redis = getRedisClient();
              const messageKey = `chat:${chatId}:messages`;
              await redis.lpush(
                messageKey,
                JSON.stringify({
                  content,
                  responseFrom: 'tools',
                  toolName,
                  timestamp: Date.now(),
                }),
              );
            } catch (redisError) {
              console.error('Redis error storing tool response:', redisError);
            }
          }
        }
      }

      // Send a final message to indicate the stream is complete
      if (hasResponse) {
        console.log('Stream complete, sending final message');
        socket.emit('response', {
          type: 'system',
          message: 'Stream complete',
          done: true,
        });
      } else {
        // If no response was received, send an error
        console.error('No response received from agent');
        socket.emit('error', { message: 'No response received from agent' });
      }
    } catch (error) {
      console.error('Socket error:', error);
      socket.emit('error', {
        message:
          'Internal error: ' +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  });
}
