-- Up Migration
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
CREATE INDEX IF NOT EXISTS idx_deployed_tokens_address ON deployed_tokens(token_address);

-- Down Migration
DROP TABLE IF EXISTS deployed_tokens;
