-- Up Migration
CREATE OR REPLACE FUNCTION up_migration_002() RETURNS void AS $$
BEGIN
    -- Deployed Tokens table
    CREATE TABLE IF NOT EXISTS deployed_tokens (
        id SERIAL PRIMARY KEY,
        agent_id UUID REFERENCES ai_agents(id),
        token_address VARCHAR(42) NOT NULL,
        token_name VARCHAR(100) NOT NULL,
        token_symbol VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(agent_id, token_address)
    );

    -- Create index for token_address
    CREATE INDEX idx_deployed_tokens_address ON deployed_tokens(token_address);
END;
$$ LANGUAGE plpgsql;

-- Down Migration
CREATE OR REPLACE FUNCTION down_migration_002() RETURNS void AS $$
BEGIN
    DROP TABLE IF EXISTS deployed_tokens;
END;
$$ LANGUAGE plpgsql;

-- Execute up migration by default
SELECT up_migration_002(); 