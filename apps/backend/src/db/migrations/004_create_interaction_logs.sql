-- Up Migration
CREATE OR REPLACE FUNCTION up_create_interaction_logs()
RETURNS void AS $$
BEGIN
    -- Create enum for sender type
    CREATE TYPE sender_type AS ENUM ('user', 'agent', 'farcaster');

    -- Create interaction_logs table
    CREATE TABLE IF NOT EXISTS interaction_logs (
        log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        sender_address TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB,
        sender sender_type NOT NULL
    );

    -- Create agent_responses table
    CREATE TABLE IF NOT EXISTS agent_responses (
        response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        log_id UUID REFERENCES interaction_logs(log_id) ON DELETE CASCADE,
        agent_id UUID NOT NULL REFERENCES ai_agents(id),
        response_content TEXT NOT NULL,
        model_version VARCHAR(255),
        response_time INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for better query performance
    CREATE INDEX idx_interaction_logs_agent_id ON interaction_logs(agent_id);
    CREATE INDEX idx_interaction_logs_timestamp ON interaction_logs(timestamp);
    CREATE INDEX idx_agent_responses_log_id ON agent_responses(log_id);
    CREATE INDEX idx_agent_responses_agent_id ON agent_responses(agent_id);
END;
$$ LANGUAGE plpgsql;

-- Down Migration
CREATE OR REPLACE FUNCTION down_create_interaction_logs()
RETURNS void AS $$
BEGIN
    -- Drop indexes
    DROP INDEX IF EXISTS idx_interaction_logs_agent_id;
    DROP INDEX IF EXISTS idx_interaction_logs_timestamp;
    DROP INDEX IF EXISTS idx_agent_responses_log_id;
    DROP INDEX IF EXISTS idx_agent_responses_agent_id;

    -- Drop tables
    DROP TABLE IF EXISTS agent_responses;
    DROP TABLE IF EXISTS interaction_logs;

    -- Drop enum
    DROP TYPE IF EXISTS sender_type;
END;
$$ LANGUAGE plpgsql;

-- Execute up migration
SELECT up_create_interaction_logs(); 