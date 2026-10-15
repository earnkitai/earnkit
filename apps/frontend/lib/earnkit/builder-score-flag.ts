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

/**
 * v2.13 The Bench: one switch on top of the score flag (plan B1). Off unless both are exactly "on";
 * off is production as it is (v2.12.2 with EARNKIT_BUILDER_SCORE=on).
 */
export const BENCH_FLAG = 'EARNKIT_BENCH';
export const benchEnabled = (env: Record<string, string | undefined> = process.env) => builderScoreEnabled(env) && env[BENCH_FLAG] === 'on';
