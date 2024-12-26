import { Pool } from "pg";

export const pool = new Pool({
  user: process.env.DB_USER || "ekt",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "earnkit",
  password: process.env.DB_PASSWORD || "password",
  port: parseInt(process.env.DB_PORT || "5432"),
});

pool.on("connect", () => {
  console.log("PostgreSQL connected successfully");
});
