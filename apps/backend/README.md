# EarnKit Backend API

## API Structure

### Public Routes (`/api/v1/auth/`)

- User Registration and Authentication
  - `POST /register` - Register a new user
  - `GET /check-user` - Check if user exists
  - `POST /create-api-key` - Create a new API key
  - `GET /get-api-keys` - Get all API keys for a user

### Private Routes (Requires API Key)

#### Wallet Operations (`/api/v1/wallet/`)

- AI Agent Wallet Management
  - `POST /create-ai-agent-wallet` - Create first AI agent with sub-organization
  - `POST /add-new-ai-agent-wallet` - Add additional AI agent to existing sub-org
  - `GET /get-ai-agent-wallet-details` - Get specific agent wallet details

#### User Operations (`/api/v1/user/`)

- User and Organization Details
  - `GET /get-user-details` - Get comprehensive user details including sub-org and agents

#### Transaction Operations (`/api/v1/transaction/`)

- Transaction Management
  - `POST /execute-transaction` - Execute a transaction using AI agent wallet

#### Configuration (`/api/v1/config/`)

- SDK Configuration
  - `GET /get-sdk-config` - Get SDK configuration details

## Authentication

All private routes require an API key to be passed in the headers:

```
x-api-key: your-api-key
```

## Flow

1. User Registration:

   - Register user with email and address
   - Create API key for authentication

2. AI Agent Creation:

   - Create first AI agent (creates sub-org automatically)
   - Add additional AI agents as needed

3. Operations:
   - View user and organization details
   - Get specific agent wallet details
   - Execute transactions using agent wallets

## Query Parameters

- `/get-user-details?address=0x...` - User's blockchain address
- `/get-ai-agent-wallet-details?agentName=...` - Name of the AI agent

## Response Format

```json
{
  "success": boolean,
  "data": {
    // Response data
  },
  "error": "Error message if success is false"
}
```

## Environment Variables

```env
TURNKEY_API_PRIVATE_KEY=
TURNKEY_API_PUBLIC_KEY=
PIMLICO_API_KEY=
ORG_ID=
DATABASE_URL=
```

## Development

```bash
npm install
npm run dev
```

## Database Migrations

```bash
npm run migrate
```
