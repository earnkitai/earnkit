/**
 * v2.12: the verified builder score's one switch, and the archive flags (spec 9). Import-free, so
 * pages, the MCP route and pure modules can read them. Off unless exactly "on".
 */
export const BUILDER_SCORE_FLAG = 'EARNKIT_BUILDER_SCORE';
export const builderScoreEnabled = (env: Record<string, string | undefined> = process.env) => env[BUILDER_SCORE_FLAG] === 'on';

export type ArchiveName = 'SPONSOR_CAMPAIGNS' | 'STARTER_REGISTRY' | 'PROGRAM_LEADERBOARDS' | 'TOOL_ALIASES';
export const archiveFlag = (name: ArchiveName, env: Record<string, string | undefined> = process.env) => env[`EARNKIT_${name}`] === 'on';

/** v2.12.1: Sign in with X is on only with both OAuth 2.0 client values set (graceful when unset). */
export const xSignInEnabled = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.X_CLIENT_ID?.trim() && env.X_CLIENT_SECRET?.trim());
