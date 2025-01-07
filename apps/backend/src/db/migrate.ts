import { pool } from './pool';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runMigration(migrationFile: string = '001_create_tables.sql') {
  try {
    const sql = readFileSync(
      join(__dirname, 'migrations', migrationFile),
      'utf8',
    );
    await pool.query(sql);
    console.log(`Migration ${migrationFile} completed successfully`);
  } catch (error) {
    console.error(`Migration ${migrationFile} failed:`, error);
  } finally {
    await pool.end();
  }
}

// Get migration file from command line argument, default to 001 if not provided
const migrationFile = process.argv[2] || '001_create_tables.sql';
runMigration(migrationFile);
