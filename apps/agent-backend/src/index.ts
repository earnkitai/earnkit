import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleSocketConnection } from './websockets/handler';
import { initializeRedis } from './redis';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(
  cors({
    origin: [
      'https://app.earny.chat',
      'https://app.earnkit.com',
      process.env.DASHBOARD_URL!,
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  }),
);
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  console.log(req.url);
  console.log('Health check requested');
  res.status(200).json({ status: 'ok' });
});

// Create HTTP server
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      'https://app.earny.chat',
      'https://app.earnkit.com',
      process.env.DASHBOARD_URL!,
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Initialize Redis
initializeRedis();

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  console.log('Client transport:', socket.conn.transport.name);

  // Handle ping messages
  socket.on('ping', (data) => {
    console.log('Received ping from client:', socket.id, data);
    socket.emit('pong', { timestamp: Date.now(), received: data.timestamp });
  });

  // Handle socket connection
  handleSocketConnection(socket);

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, 'Reason:', reason);
  });
});

// Start server
const PORT = process.env.PORT || 3100;
server.listen(PORT, () => {
  console.log(`Agent backend server running on http://localhost:${PORT}`);
});
