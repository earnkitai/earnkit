/**
 * The switches that remain. v2.14 retired the builder-score and Bench switches (the Bench is the
 * product). Import-free, so pages, the MCP route and pure modules can read them. Off unless exactly "on".
 */
export type ArchiveName = 'SPONSOR_CAMPAIGNS' | 'STARTER_REGISTRY' | 'PROGRAM_LEADERBOARDS' | 'TOOL_ALIASES';
export const archiveFlag = (name: ArchiveName, env: Record<string, string | undefined> = process.env) => env[`EARNKIT_${name}`] === 'on';

/** Sign in with X is on only with both OAuth 2.0 client values set (graceful when unset). */
export const xSignInEnabled = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.X_CLIENT_ID?.trim() && env.X_CLIENT_SECRET?.trim());

/** The community round's pill and asks: the legal switch (spec 5: "EARNKIT_RAISING stays"). */
export const RAISING_FLAG = 'EARNKIT_RAISING';
export const raisingEnabled = (env: Record<string, string | undefined> = process.env) => env[RAISING_FLAG] === 'on';
