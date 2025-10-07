# EarnKit SDK - Complete Features and Flow Documentation

## 🚀 SDK Overview

The EarnKit SDK is a comprehensive monetization platform for AI agents that enables developers to track usage, manage credits, and process payments through blockchain transactions.

## 📋 SDK Features

### 🔧 **Core Configuration**

- **Agent ID**: Unique identifier for your AI agent
- **API Key Authentication**: Secure API access with Bearer token
- **Base URL**: Configurable backend endpoint
- **Debug Mode**: Detailed logging for development
- **Request Timeout**: Configurable timeout settings

### 🎯 **Core Functions**

#### 1. **Event Tracking System**

- **`track()`**: Initiates trackable events with provisional credit deduction
- **`capture()`**: Finalizes successful events and confirms charges
- **`release()`**: Refunds provisionally held credits for failed events

#### 2. **Balance Management**

- **`getBalance()`**: Retrieves user's ETH and credit balance
- **`pollForBalanceUpdate()`**: Monitors balance changes after top-ups

#### 3. **Top-up System**

- **`getTopUpDetails()`**: Fetches available top-up packages
- **`submitTopUpTransaction()`**: Submits blockchain transactions for monitoring

### 🛡️ **Security Features**

- **API Key Authentication**: All endpoints require valid API keys
- **Input Validation**: Comprehensive parameter validation
- **Error Handling**: Detailed error types and messages
- **Retry Logic**: Automatic retry with exponential backoff

### 🔄 **Advanced Features**

- **Idempotency**: Prevents duplicate charges with idempotency keys
- **Debug Logging**: Detailed request/response logging
- **Request Retry**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Timeout Handling**: Configurable request timeouts

## 🏗️ Backend Architecture

### **API Endpoints**

#### **Core Endpoints**

- `POST /api/track` - Track events with provisional credit deduction
- `POST /api/capture` - Finalize successful events
- `POST /api/release` - Refund failed events
- `GET /api/balance` - Get user balance
- `GET /api/top-up-details` - Get top-up options
- `POST /api/top-up-details` - Submit top-up transactions

#### **Debug Endpoints** (Development only)

- `GET /api/debug/events` - Get all tracked events
- `GET /api/debug/balances` - Get all user balances
- `GET /api/debug/transactions` - Get all transactions
- `GET /api/debug/status` - Get system status

#### **Health Check**

- `GET /health` - Server health status

### **Database Schema**

#### **Core Tables**

- **`users`**: User accounts with API keys
- **`agents`**: AI agent configurations
- **`user_balances`**: User ETH and credit balances
- **`usage_events`**: Tracked events with status
- **`top_up_transactions`**: Blockchain transaction monitoring
- **`top_up_packages`**: Available top-up options

## 🔄 Complete Flow Documentation

### **1. SDK Initialization Flow**

```typescript
// Initialize SDK with API key
const earnKit = new EarnKit({
  agentId: 'your-agent-id',
  apiKey: 'ek_your-api-key',
  baseUrl: 'http://localhost:3000',
  debug: true,
});
```

**Backend Process:**

1. SDK validates configuration
2. API key is stored for future requests
3. Base URL and timeout settings are configured

### **2. Event Tracking Flow**

#### **Step 1: Track Event**

```typescript
const result = await earnKit.track({
  walletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
  creditsToDeduct: 1,
  idempotencyKey: 'unique-key-123',
});
```

**Backend Process:**

1. **API Key Validation**: Middleware validates API key
2. **Parameter Validation**: Validates wallet address and parameters
3. **Agent Lookup**: Finds agent by agentId
4. **Balance Check**: Verifies sufficient credits
5. **Provisional Deduction**: Deducts credits temporarily
6. **Event Creation**: Creates usage event with PENDING status
7. **Response**: Returns eventId

#### **Step 2: Process AI Logic**

```typescript
// Your AI processing logic here
const aiResponse = await processAIRequest();
```

#### **Step 3A: Capture Event (Success)**

```typescript
const captureResult = await earnKit.capture({
  eventId: result.eventId,
});
```

**Backend Process:**

1. **Event Lookup**: Finds event by eventId
2. **Status Check**: Verifies event is PENDING
3. **Status Update**: Changes status to COMPLETED
4. **Finalization**: Credits are permanently deducted

#### **Step 3B: Release Event (Failure)**

```typescript
try {
  // AI processing
} catch (error) {
  await earnKit.release({ eventId: result.eventId });
}
```

**Backend Process:**

1. **Event Lookup**: Finds event by eventId
2. **Status Check**: Verifies event is PENDING
3. **Credit Refund**: Refunds provisionally held credits
4. **Status Update**: Changes status to CANCELLED

### **3. Balance Management Flow**

#### **Get Balance**

```typescript
const balance = await earnKit.getBalance({
  walletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
});
```

**Backend Process:**

1. **API Key Validation**: Validates API key
2. **Agent Lookup**: Finds agent by agentId
3. **Balance Query**: Retrieves user balance
4. **Response**: Returns ETH and credit balance

#### **Poll for Balance Updates**

```typescript
earnKit.pollForBalanceUpdate({
  walletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
  initialBalance,
  onConfirmation: (newBalance) => {
    console.log('Balance updated:', newBalance);
  },
  onTimeout: () => {
    console.log('Polling timeout');
  },
  pollInterval: 10000, // 10 seconds
  maxPolls: 30, // 5 minutes
});
```

**Backend Process:**

1. **Polling Loop**: Repeatedly calls getBalance
2. **Change Detection**: Compares with initial balance
3. **Callback Execution**: Calls onConfirmation when balance increases
4. **Timeout Handling**: Calls onTimeout after maxPolls

### **4. Top-up Flow**

#### **Get Top-up Options**

```typescript
const topUpDetails = await earnKit.getTopUpDetails();
```

**Backend Process:**

1. **API Key Validation**: Validates API key
2. **Agent Lookup**: Finds agent by agentId
3. **Package Query**: Retrieves available top-up packages
4. **Response**: Returns formatted options with ETH amounts and WEI values

#### **Submit Top-up Transaction**

```typescript
const result = await earnKit.submitTopUpTransaction({
  txHash: '0x1234567890abcdef...',
  walletAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
  amountInEth: '0.001',
  creditsToTopUp: 10,
});
```

**Backend Process:**

1. **API Key Validation**: Validates API key
2. **Parameter Validation**: Validates transaction hash and amounts
3. **Transaction Recording**: Creates transaction record with PENDING status
4. **Monitoring Setup**: Starts monitoring for blockchain confirmation
5. **Response**: Returns submission status

### **5. Error Handling Flow**

#### **Error Types**

- **`EarnKitInitializationError`**: Configuration errors
- **`EarnKitInputError`**: Invalid parameters
- **`EarnKitApiError`**: API/network errors

#### **Retry Logic**

1. **Initial Attempt**: First API call
2. **Retry 1**: After 1 second delay
3. **Retry 2**: After 2 second delay
4. **Final Error**: After 3 attempts

#### **Error Scenarios**

- **Network Failures**: Automatic retry with exponential backoff
- **API Key Invalid**: Immediate failure with 401 status
- **Insufficient Credits**: Immediate failure with 400 status
- **Invalid Parameters**: Immediate failure with validation errors

## 🔐 Security Implementation

### **API Key Authentication**

- **Bearer Token**: `Authorization: Bearer ek_api_key`
- **Alternative Header**: `X-API-Key: ek_api_key`
- **Validation**: Database lookup for valid API keys
- **Error Response**: 401 for invalid/missing keys

### **Input Validation**

- **Wallet Address**: Must start with '0x' and be 42 characters
- **Agent ID**: Required non-empty string
- **Event ID**: Required for capture/release operations
- **Transaction Hash**: Must start with '0x' and be 66 characters

### **Database Security**

- **API Key Storage**: Encrypted storage in database
- **User Isolation**: Users can only access their own data
- **Agent Validation**: API keys are tied to specific agents

## 📊 Monitoring and Debugging

### **Debug Endpoints**

- **Events**: View all tracked events and their status
- **Balances**: View all user balances
- **Transactions**: View all top-up transactions
- **Status**: System-wide statistics

### **Logging**

- **Request Logging**: All API calls with parameters
- **Response Logging**: All API responses
- **Error Logging**: Detailed error information
- **Debug Mode**: Enhanced logging for development

## 🚀 Production Deployment

### **Environment Variables**

```bash
DATABASE_URL=postgresql://...
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_secret
NODE_ENV=production
```

### **API Key Management**

- **Generation**: Use `/api/api-key/generate` endpoint
- **Rotation**: Use `/api/api-key/regenerate` endpoint
- **Revocation**: Use `/api/api-key` DELETE endpoint

### **Monitoring**

- **Health Checks**: `/health` endpoint
- **Debug Endpoints**: Available in development mode
- **Error Tracking**: Comprehensive error logging

## 📈 Usage Examples

### **Complete AI Agent Integration**

```typescript
import { EarnKit } from '@earnkit/earn';

const earnKit = new EarnKit({
  agentId: 'your-agent-id',
  apiKey: 'ek_your-api-key',
  debug: true,
});

async function processAIRequest(userWallet: string) {
  let eventId: string;

  try {
    // Track the event
    const trackResult = await earnKit.track({
      walletAddress: userWallet,
      creditsToDeduct: 1,
      idempotencyKey: `request-${Date.now()}`,
    });
    eventId = trackResult.eventId;

    // Process AI request
    const aiResponse = await yourAIProcessing();

    // Capture the event (success)
    await earnKit.capture({ eventId });

    return aiResponse;
  } catch (error) {
    // Release the event (failure)
    if (eventId) {
      await earnKit.release({ eventId });
    }
    throw error;
  }
}
```

### **Balance Management**

```typescript
// Check user balance
const balance = await earnKit.getBalance({
  walletAddress: userWallet,
});

// Monitor for top-up completion
earnKit.pollForBalanceUpdate({
  walletAddress: userWallet,
  initialBalance: balance,
  onConfirmation: (newBalance) => {
    console.log('Top-up completed:', newBalance);
  },
});
```

### **Top-up Integration**

```typescript
// Get available top-up options
const options = await earnKit.getTopUpDetails();

// Submit transaction after user pays
const result = await earnKit.submitTopUpTransaction({
  txHash: userTransactionHash,
  walletAddress: userWallet,
  amountInUSD: '3.00', // USD amount
  amountInEth: '0.001', // Converted ETH amount
  creditsToTopUp: 10,
});
```

This comprehensive documentation covers all SDK features, backend architecture, complete flow implementation, and production deployment guidelines.
