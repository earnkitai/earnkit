-- Create Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    organization_id VARCHAR(255) NOT NULL,
    sign_with VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Create Agents table
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL,
    salt_nonce BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);

-- Create API Keys table
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashed_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',
    active BOOLEAN DEFAULT TRUE,
    usage_count INT DEFAULT 0,
    max_usage INT DEFAULT 1000,
    subscription_type VARCHAR(50) DEFAULT 'free'
);

-- Create Keys table
CREATE TABLE IF NOT EXISTS keys (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
); 

ALTER TABLE wallets ADD COLUMN public_key TEXT;
ALTER TABLE wallets ADD COLUMN private_key TEXT;

-- Ensure proper foreign key relationships
ALTER TABLE wallets 
  ADD CONSTRAINT fk_user_id 
  FOREIGN KEY (user_id) 
  REFERENCES users(user_id) 
  ON DELETE CASCADE;

ALTER TABLE agents
  ADD CONSTRAINT fk_wallet_id
  FOREIGN KEY (wallet_id)
  REFERENCES wallets(id)
  ON DELETE CASCADE;

ALTER TABLE api_keys
  ADD CONSTRAINT fk_user_id
  FOREIGN KEY (user_id)
  REFERENCES users(id)
  ON DELETE CASCADE;