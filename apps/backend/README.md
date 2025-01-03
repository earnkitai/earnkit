# AI Agent Wallet Backend API

## Overview

Backend service for managing AI agent wallets, user authentication, and transaction execution using Account Abstraction. Built with Express.js, PostgreSQL, and Turnkey.

## Project Structure

- `src/controllers`: Contains controller functions for handling API requests.
- `src/middleware`: Contains middleware for handling API requests.
- `src/routes`: Contains routes for handling API requests.
- `src/utils`: Contains utility functions for handling API requests.
- `src/db`: Contains database configuration and queries.(tables and migrations)
- `src/config`: Contains configuration for the application (psql and neynar cofig).
- `src/models`: Contains models for handling API requests.

## Database

- `users`: Contains user information.
- `wallets`: Contains wallet information created by turnkey.
- `agents`: Contains agent wallet information .
- `api_keys`: Contains api keys information for earnkit platform use.
- `keys`: Contains turnkey keys information for wallet initialization.

## Migrations

- `001_create_tables.sql`: Contains the create tables sql.
  to run migrations:

```
tsx src/db/migrations/001_create_tables.sql
```

---

# API Documentation

This document provides an overview of the available endpoints in the API, including the required requests, headers, and expected responses. The API uses `x-api-key` in headers for all private endpoints.

---

## Public Endpoints

### 1. Register a New User

**URL:** `http://localhost:3000/api/public/auth/register`

**Method:** `POST`

**Purpose:**
To register the user on the EarnKit platform. This allows the user to log in to the dashboard, generate API keys, deploy an AI agent, and view dashboard insights.

**Request Body:**

```json
{
  "address": "<User's blockchain address>",
  "email": "<User's email>"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "<User's blockchain address>",
    "email": "<User's email>"
  }
}
```

---

### 2. Create an API Key

**URL:** `http://localhost:3000/api/public/auth/create-api-key`

**Method:** `POST`

**Purpose:**
This endpoint is used to generate an API key, which will be used in other endpoint calls.

**Request Body:**

```json
{
  "userId": "<User's blockchain address>",
  "subscriptionType": "<Subscription type: free, premium, enterprise>",
  "expiresAt": "<Expiration date in ISO 8601 format>",
  "maxUsage": <Maximum API call limit>
}
```

**Response:**

```json
{
    "message": "API key created successfully",
    "apiKey": "<Generated API key>",
    "id": <Key ID>
}
```

---

### 3. Get User's API Keys

**URL:** `http://localhost:3000/api/public/api-keys?address=<User's blockchain address>`

**Method:** `GET`

**Purpose:**
To list all the API keys of the user in the dashboard.

**Response:**

```json
{
    "success": true,
    "data": {
        "address": "<User's blockchain address>",
        "apiKeys": [
            {
                "hashedKey": "<Hashed API key>",
                "createdAt": "<Creation timestamp>",
                "expiresAt": "<Expiration timestamp>",
                "active": true,
                "usageCount": <Number of uses>,
                "maxUsage": <Maximum usage count>,
                "subscriptionType": "<Subscription type>"
            }
        ]
    }
}
```

---

### 4. Check if a User Exists

**URL:** `http://localhost:3000/api/public/check-user?address=<User's blockchain address>`

**Method:** `GET`

**Purpose:**
To check if the user is registered. A signed data payload is passed, and the API verifies whether the user is present in the system.

**Response:**

```json
{
  "success": true,
  "exists": true,
  "data": {
    "address": "<User's blockchain address>",
    "email": "<User's email>"
  }
}
```

---

## Private Endpoints

### 1. Create an AI Agent Wallet

**URL:** `http://localhost:3000/api/private/create-ai-agent-wallet`

**Method:** `POST`

**Headers:**

```
x-api-key: <Your API key>
```

**Purpose:**
This endpoint is used to create an AI agent wallet. It involves the process of creating sub-organizations (which will own and control the safe account) and creating the safe account, which will serve as the AI agent wallet.

**Request Body:**

```json
{
  "agentName": "<Agent name>"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "organizationId": "<Organization ID>",
    "wallet": {
      "address": "<Wallet address>",
      "organizationId": "<Organization ID>"
    },
    "agent": {
      "name": "<Agent name>",
      "smartAccountAddress": "<Smart account address>"
    }
  }
}
```

---

### 2. Get User Details

**URL:** `http://localhost:3000/api/private/get-user-details?address=<User's blockchain address>`

**Method:** `GET`

**Headers:**

```
x-api-key: <Your API key>
```

**Purpose:**
To retrieve the user's details.

**Response:**

```json
{
    "success": true,
    "data": {
        "user": {
            "userId": "<User's blockchain address>",
            "email": "<User's email>"
        },
        "wallet": {
            "signWith": "<Wallet signature address>",
            "organizationId": "<Organization ID>"
        },
        "agents": [
            {
                "name": "<Agent name>",
                "address": "<Agent address>",
                "saltNonce": <Salt nonce>
            }
        ]
    }
}
```

---

### 3. Get Wallet Details for an AI Agent

**URL:** `http://localhost:3000/api/private/wallet-details?agentName=<Agent name>`

**Method:** `GET`

**Headers:**

```
x-api-key: <Your API key>
```

**Purpose:**
To retrieve wallet details of the agent for creating an instance whenever a transaction is needed.

**Response:**

```json
{
    "success": true,
    "data": {
        "organization_id": "<Organization ID>",
        "sign_with": "<Wallet signature address>",
        "agent": {
            "name": "<Agent name>",
            "address": "<Agent address>",
            "saltNonce": <Salt nonce>
        }
    }
}
```

---

### 4. Get SDK Configuration

**URL:** `http://localhost:3000/api/private/get-sdk-config`

**Method:** `GET`

**Headers:**

```
x-api-key: <Your API key>
```

**Purpose:**
To retrieve the configurations required for creating a wallet instance. This includes the keys needed to generate a turnkey signer, which controls the safe account. This endpoint is used in the EarnKit SDK for initializing wallets for blockchain interaction.

**Response:**

```json
{
  "turnkeyApiPrivateKey": "<Private key>",
  "turnkeyApiPublicKey": "<Public key>",
  "pimlicoApiKey": "<Pimlico API key>",
  "pimlicoUrl": "<Pimlico URL>"
}
```

## Notes

- All private endpoints require the `x-api-key` header.
- Ensure all dates are formatted in ISO 8601.
- Replace placeholders (e.g., `<User's blockchain address>`) with actual values during implementation.

## Turnkey Key Management

We use Turnkey to create sub-organizations and wallets for each user.  
We are creating sub-orgs, which act as custodial wallets for each user.  
Sub-orgs are created under our main organization, and we generate API public and private keys for each sub-org.  
The API public key pairs are securely stored in our database. No one other than the users can access these API keys.

## AI Agent Wallet Management

We have a Turnkey user that acts as the owner of the AI agent wallets.  
The AI agent wallet is created during the process of sub-org creation using the `create-ai-agent-wallet` endpoint.  
If users want to have multiple agents, they can create them using the `add-ai-agent-wallet` endpoint.

AI agent wallets are created using the permissionless `toSafeAccount` method, which deploys a safe account with a single owner. The single owner is the Turnkey sub-org.

## Gas Sponsor: Pimlico

We are using Pimlico to sponsor gas fees on behalf of the AI agent wallet.
