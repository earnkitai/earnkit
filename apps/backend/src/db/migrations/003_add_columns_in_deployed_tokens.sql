-- Up Migration
CREATE OR REPLACE FUNCTION up_migration_003() RETURNS void AS $$
BEGIN
    -- Add lockerAddress and tokenId columns to deployed_tokens table
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployed_tokens' AND column_name = 'locker_address'
    ) THEN
        ALTER TABLE deployed_tokens ADD COLUMN locker_address VARCHAR(42);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployed_tokens' AND column_name = 'token_id'
    ) THEN
        ALTER TABLE deployed_tokens ADD COLUMN token_id BIGINT;
    END IF;

    -- Create index for locker_address
    CREATE INDEX IF NOT EXISTS idx_deployed_tokens_locker_address ON deployed_tokens(locker_address);

    -- Create index for token_id
    CREATE INDEX IF NOT EXISTS idx_deployed_tokens_token_id ON deployed_tokens(token_id);
END;
$$ LANGUAGE plpgsql;

-- Down Migration
CREATE OR REPLACE FUNCTION down_migration_003() RETURNS void AS $$
BEGIN
    -- Remove locker_address and token_id columns
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployed_tokens' AND column_name = 'locker_address'
    ) THEN
        ALTER TABLE deployed_tokens DROP COLUMN locker_address;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'deployed_tokens' AND column_name = 'token_id'
    ) THEN
        ALTER TABLE deployed_tokens DROP COLUMN token_id;
    END IF;

    -- Drop indexes
    DROP INDEX IF EXISTS idx_deployed_tokens_locker_address;
    DROP INDEX IF EXISTS idx_deployed_tokens_token_id;
END;
$$ LANGUAGE plpgsql;

-- Execute up migration by default
SELECT up_migration_003();
