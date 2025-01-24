-- Up Migration
CREATE OR REPLACE FUNCTION up_create_agent_farcaster_and_config()
RETURNS void AS $outer$
BEGIN
    -- First create the update_updated_at_column function
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $inner$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $inner$ LANGUAGE plpgsql;

    -- Create agent_farcaster_details table
    CREATE TABLE IF NOT EXISTS agent_farcaster_details (
        id SERIAL PRIMARY KEY,
        agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        signer_uuid TEXT NOT NULL,
        fid INTEGER NOT NULL,
        public_key TEXT NOT NULL,
        pfp_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_agent_farcaster UNIQUE (agent_id)
    );

    -- Create agent_config table
    CREATE TABLE IF NOT EXISTS agent_config (
        id SERIAL PRIMARY KEY,
        agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_agent_config UNIQUE (agent_id)
    );

    -- Create indexes
    CREATE INDEX idx_agent_farcaster_agent_id ON agent_farcaster_details(agent_id);
    CREATE INDEX idx_agent_config_agent_id ON agent_config(agent_id);

    -- Create triggers for updated_at after tables and function exist
    CREATE TRIGGER update_agent_farcaster_modtime
        BEFORE UPDATE ON agent_farcaster_details
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_agent_config_modtime
        BEFORE UPDATE ON agent_config
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
END;
$outer$ LANGUAGE plpgsql;

-- Down Migration
CREATE OR REPLACE FUNCTION down_create_agent_farcaster_and_config()
RETURNS void AS $outer$
BEGIN
    -- Drop triggers first
    DROP TRIGGER IF EXISTS update_agent_farcaster_modtime ON agent_farcaster_details;
    DROP TRIGGER IF EXISTS update_agent_config_modtime ON agent_config;

    -- Drop tables
    DROP TABLE IF EXISTS agent_farcaster_details;
    DROP TABLE IF EXISTS agent_config;

    -- Drop function last
    DROP FUNCTION IF EXISTS update_updated_at_column();

    -- Drop indexes (though these would be dropped automatically with the tables)
    DROP INDEX IF EXISTS idx_agent_farcaster_agent_id;
    DROP INDEX IF EXISTS idx_agent_config_agent_id;
END;
$outer$ LANGUAGE plpgsql;

-- Execute up migration
SELECT up_create_agent_farcaster_and_config(); 