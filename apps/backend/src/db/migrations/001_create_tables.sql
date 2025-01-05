-- Up Migration
CREATE OR REPLACE FUNCTION up_migration() RETURNS void AS $$
BEGIN
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL UNIQUE,  -- blockchain address
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Platform API keys table
    CREATE TABLE IF NOT EXISTS platform_api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        api_key TEXT NOT NULL,  -- storing original key
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        usage_count INTEGER DEFAULT 0,
        max_usage INTEGER DEFAULT 1000,
        subscription_type VARCHAR(50) DEFAULT 'free',
        UNIQUE(api_key)
    );

    -- Sub Organizations table (one per user)
    CREATE TABLE IF NOT EXISTS sub_organizations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
        organization_id VARCHAR(255) NOT NULL UNIQUE,
        owner_wallet_address VARCHAR(255) NOT NULL,  -- sign_with address
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- AI Agents table (multiple per sub-org)
    CREATE TABLE IF NOT EXISTS ai_agents (
        id SERIAL PRIMARY KEY,
        sub_org_id INTEGER NOT NULL REFERENCES sub_organizations(id),
        name VARCHAR(255) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL UNIQUE,
        salt_nonce NUMERIC NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sub_org_id, name)  -- prevent duplicate agent names per sub-org
    );

    -- Create indexes
    CREATE INDEX idx_users_user_id ON users(user_id);
    CREATE INDEX idx_platform_api_keys_api_key ON platform_api_keys(api_key);
    CREATE INDEX idx_ai_agents_wallet_address ON ai_agents(wallet_address);
END;
$$ LANGUAGE plpgsql;

-- Down Migration
CREATE OR REPLACE FUNCTION down_migration() RETURNS void AS $$
BEGIN
    DROP TABLE IF EXISTS ai_agents;
    DROP TABLE IF EXISTS sub_organizations;
    DROP TABLE IF EXISTS platform_api_keys;
    DROP TABLE IF EXISTS users;
END;
$$ LANGUAGE plpgsql;

-- Execute up migration by default
SELECT up_migration();