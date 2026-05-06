# Agent Backend

This is a standalone backend service for handling socket connections and Redis for agent responses in the EarnKit application.

## Features

- Socket.IO server for real-time communication
- Redis integration for message persistence
- Agent initialization and management
- Health check endpoint

## Prerequisites

- Node.js (v16 or higher)
- Redis server

## Installation

1. Clone the repository
2. Navigate to the agent-backend directory
3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file based on the `.env.example` file and fill in your environment variables

## Development

To run the server in development mode:

```bash
npm run dev
```

## Production

To build and run the server in production mode:

```bash
npm run build
npm start
```

## Environment Variables

- `PORT`: The port on which the server will run (default: 3100)
- `REDIS_URL`: The URL of the Redis server (default: redis://localhost:6379)
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `EARNKIT_API_KEY`: Your EarnKit API key
- `EARNKIT_AGENT_NAME`: Your EarnKit agent name
- `PIMLICO_URL`: Your Pimlico URL
- `PIMLICO_API_KEY`: Your Pimlico API key
- `EARNKIT_BACKEND_API_URL`: Your EarnKit backend API URL
- `COINGECKO_API_KEY`: Your CoinGecko API key
- `ALCHEMY_API_KEY`: Your Alchemy API key

## API Endpoints

- `GET /health`: Health check endpoint

## Socket Events

- `message`: Send a message to the agent
- `response`: Receive a response from the agent
- `error`: Receive an error message
