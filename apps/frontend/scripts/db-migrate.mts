import './env.mts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../lib/earnkit/db';

const db = sql();
await db.unsafe(readFileSync(join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8'));
console.log('Schema is up to date.');
await db.end();
