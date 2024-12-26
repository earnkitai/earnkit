import { pool } from "./pool";
import { readFileSync } from "fs";
import { join } from "path";

async function runMigration() {
  try {
    const sql = readFileSync(
      join(__dirname, "migrations/001_create_tables.sql"),
      "utf8"
    );
    await pool.query(sql);
    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await pool.end();
  }
}

runMigration();
