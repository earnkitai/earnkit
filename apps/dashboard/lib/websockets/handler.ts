import { Socket } from 'socket.io';
import { initializeAgent } from './initializeAgent'; // Move your logic there
import { HumanMessage } from '@langchain/core/messages';

export function handleSocketConnection(socket: Socket) {
  socket.on('message', async (data) => {
    try {
      const { message, userWalletAddress, chatId } = data;

      const agentInstance = await initializeAgent(userWalletAddress, chatId);
      const stream = await agentInstance.agent.stream(
        {
          messages: [new HumanMessage(message)],
        },
        agentInstance.config,
      );

      let hasResponse = false;
      for await (const chunk of stream) {
        hasResponse = true;
        if ('agent' in chunk) {
          const content = chunk.agent.messages[0].content;
          socket.emit('response', { type: 'agent', message: content });
        }

        if ('tools' in chunk) {
          const content = chunk.tools.messages[0].content;
          socket.emit('response', {
            type: 'tools',
            message: content,
            tool_name: chunk.tools.messages[0].name,
          });
        }
      }

      // Send a final message to indicate the stream is complete
      if (hasResponse) {
        socket.emit('response', {
          type: 'system',
          message: 'Stream complete',
          done: true,
        });
      } else {
        // If no response was received, send an error
        socket.emit('error', { message: 'No response received from agent' });
      }
    } catch (error) {
      console.error('Socket error:', error);
      socket.emit('error', { message: 'Internal error' });
    }
  });
}
