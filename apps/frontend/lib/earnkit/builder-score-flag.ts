/**
 * v2.12: the verified builder score's one switch, and the archive flags (spec 9). Import-free, so
 * pages, the MCP route and pure modules can read them. Off unless exactly "on".
 */
export const BUILDER_SCORE_FLAG = 'EARNKIT_BUILDER_SCORE';
export const builderScoreEnabled = (env: Record<string, string | undefined> = process.env) => env[BUILDER_SCORE_FLAG] === 'on';

export type ArchiveName = 'SPONSOR_CAMPAIGNS' | 'STARTER_REGISTRY' | 'PROGRAM_LEADERBOARDS' | 'TOOL_ALIASES';
export const archiveFlag = (name: ArchiveName, env: Record<string, string | undefined> = process.env) => env[`EARNKIT_${name}`] === 'on';
