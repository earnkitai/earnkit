/** The install steps per agent: pure data, read by the install sheet, the /docs page and /llms.txt. */
export const MCP_URL = 'https://earnkit.com/mcp';

/** "connector" explained once, in the intro both install surfaces show above the tabs (Grok Bot's tab uses the word). */
export const CONNECTOR_LINE = 'A connector lets your AI use EarnKit.';

/** Pure. The tab a key moves to from `at` among `n` tabs (arrows wrap, Home and End jump), or null for any other key. */
export function tabKeyTarget(key: string, at: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export type AgentName = 'Grok Bot' | 'Muse' | 'OpenClaw' | 'Hermes' | 'Claude' | 'Claude Code' | 'Cursor' | 'Codex';

/**
 * What the Grok Bot button types into Grok Bot's composer (the builder presses Enter, then "Add it" and
 * "Authorize"). "custom MCP server" so the bot adds it with AddMcpServer instead of searching the plugin catalog.
 */
export const GROK_BOT_PROMPT = `Add a custom MCP server called EarnKit at ${MCP_URL}, sign me in, then ask EarnKit what I can earn.`;

/**
 * Grok Bot's prompt deep link (registered schemes grokbot:// and sand://, route app/v1/prompt, read from the Grok Bot
 * app v0.75.0): it opens Grok Bot with `text` (at most 1000 characters) typed in the main bot's composer and never
 * sends it. A composer that already holds a draft keeps it. Pure.
 */
export const grokBotPromptLink = (text: string): string => {
  if (text.length > 1000) throw new Error('Grok Bot prompt links carry at most 1000 characters');
  return `grokbot://app/v1/prompt?text=${encodeURIComponent(text)}`;
};

/** The message a Muse builder sends (Muse builds connectors in chat; it has no add-server form). */
export const MUSE_MESSAGE = `Build a custom connector to ${MCP_URL} (Streamable HTTP). Sign me in, test it, then save it as a skill.`;

export type Agent = {
  name: AgentName;
  /**
   * The tab's icon, a local file under public/ ("/images/agents/<file>.svg|png"), never fetched from
   * elsewhere. An SVG mark is drawn in one color (the tab's); a PNG is the app's own icon, in color.
   */
  icon: string;
  /** One plain line above the steps (Claude: the Free plan's limit). */
  note?: string;
  /** One-click install deep link, when the agent supports one. */
  install?: string;
  /** The deep link button's words ("Add to <name>" when unset). */
  installLabel?: string;
  /** One line under the deep link button: what the builder does next. */
  installNote?: string;
  /** One line above the steps (Grok Bot: the steps are the fallback to its button). */
  stepsLead?: string;
  /** A message the builder copies and sends to their agent, shown in a box with its own Copy button. */
  message?: string;
  steps: string[];
  code?: string;
  /** One line after the command (the approve step). */
  after?: string;
  /** A command inside `after` the builder runs too, shown with its own Copy button. */
  afterCode?: string;
  /** One closing line after the after command (Hermes: reload its MCP servers). */
  last?: string;
};

/**
 * The install tabs. The EarnKit link box above the tabs serves any other agent.
 *
 * Icon sources (each the maker's own, stored locally; SVG marks drawn in one color):
 * - grok-bot.png: Grok Bot's own app icon (the macOS app by SpaceXAI, "Copyright © 2026 SpaceXAI"),
 *   dist/renderer/assets/app-icon-*.png inside Grok Bot.app's app.asar (the same art as its
 *   icon.icns), scaled from 256px to 64px. Grok Bot is not Grok: these tabs use its own app icon.
 *   The landing hero's agent row (app/components/site/AgentMarks.tsx) shows
 *   the lobehub Grok mark for Grok Bot, as the owner-approved canvas does; nowhere else uses it.
 * - claude-code.svg: Anthropic press kit, https://www.anthropic.com/press-kit
 *   (Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg), unchanged.
 * - cursor.svg: Cursor brand page, https://cursor.com/brand
 *   (cursor-brand-assets.zip, Cube/SVG/CUBE_2D_LIGHT.svg), the same path with its class style
 *   written as a fill attribute.
 * - codex.svg: OpenAI brand guidelines, https://openai.com/brand/
 *   (openai-logos.zip, OAI_OpenAI-Blossom_Black.svg), the same path with the viewBox cropped to
 *   the mark (the clear space is the tab's own padding at 20px).
 * - muse.svg: Muse's logo from its official site, https://muse.ai/images/landing/brand/muse-logo.svg
 *   (muse.ai is the site Meta's announcement names: https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/),
 *   the same path; its blue gradient fill is flattened to its middle stop (#0064E0), since the
 *   logo checks refuse url() and the tab draws the mark in one color anyway.
 * - openclaw.svg: OpenClaw's lobster mark from its official site, https://openclaw.ai/favicon.svg, the same paths;
 *   its gradient fill flattened to one color and the eyes dropped (the tab draws the mark in one color).
 *
 * Commands: Claude Code per https://code.claude.com/docs/en/mcp (--transport http, --scope user,
 * then /mcp to sign in); Codex per https://learn.chatgpt.com/docs/extend/mcp?surface=cli
 * (codex mcp add <name> --url <url>, then codex mcp login <name>); OpenClaw per https://docs.openclaw.ai/tools/mcp
 * (with the gateway stopped: openclaw mcp add <name> --url <url> --transport streamable-http --auth oauth, then
 * openclaw mcp login <name>, then the gateway starts again; a headless server pastes the printed --code command); Hermes per
 * https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp (no add-by-URL command: mcp_servers in
 * ~/.hermes/config.yaml with auth: oauth, then hermes mcp login <name> and /reload-mcp). hermes.png: Hermes Agent's own
 * icon from its official site (https://hermes-agent.nousresearch.com/, the page's 48px icon.png), unchanged.
 * Claude (claude.ai and the desktop app) per https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 * (the confirmed steps in docs/design-docs-and-implementation-plans/v3.1-install-research.md);
 * its icon is the same Claude Spark as Claude Code's. ChatGPT has no tab: OpenAI's official pages could not be read
 * on 2026-10-22, so its steps are unconfirmed.
 * The owner's order: the personal agents first (Grok Bot, Muse, OpenClaw, Hermes), then
 * Claude, Claude Code, Cursor, Codex. Instinct documents no way to add an MCP server, so it has no tab.
 * One-click links only where the agent has one: Grok Bot's prompt link (grokBotPromptLink, read from the Grok Bot app:
 * it types GROK_BOT_PROMPT and the builder presses Enter) and Cursor's MCP install deep link (Cursor docs, "Add to
 * Cursor" links: cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the server's config>),
 * each shown first in its tab. Grok Bot's fallback uses the app's own labels (Plugins, "Add a custom connector",
 * "Server URL", Save, Authenticate). Muse has no add-server form: the builder sends MUSE_MESSAGE and Muse builds the
 * connector in chat. Claude Code, Codex, OpenClaw and Hermes document none, so none is made up.
 */
export const AGENTS: Agent[] = [
  {
    name: 'Grok Bot',
    icon: '/images/agents/grok-bot.png',
    install: grokBotPromptLink(GROK_BOT_PROMPT),
    installLabel: 'Open in Grok Bot',
    installNote: 'Press Enter, then "Add it" and "Authorize". It connects at once. No account needed.',
    stepsLead: 'Or by hand:',
    steps: [
      'Plugins, then "Add a custom connector".',
      `Server URL ${MCP_URL}, "Save", then "Authenticate". It connects at once. No account needed.`,
    ],
  },
  {
    name: 'Muse',
    icon: '/images/agents/muse.svg',
    steps: ['Send Muse this message:'],
    message: MUSE_MESSAGE,
  },
  {
    name: 'OpenClaw',
    icon: '/images/agents/openclaw.svg',
    steps: ['Stop the gateway, then add and approve it where OpenClaw runs:'],
    code: [
      'openclaw gateway stop',
      `openclaw mcp add earnkit --url ${MCP_URL} --transport streamable-http --auth oauth`,
      'openclaw mcp login earnkit',
      'openclaw gateway start',
    ].join('\n'),
    last: 'On a server with no browser, run the --code command the login prints.',
  },
  {
    name: 'Hermes',
    icon: '/images/agents/hermes.png',
    steps: ['Add this to ~/.hermes/config.yaml:'],
    code: `mcp_servers:\n  earnkit:\n    url: "${MCP_URL}"\n    auth: oauth`,
    after: 'Then approve it:',
    afterCode: 'hermes mcp login earnkit',
    last: 'Then type /reload-mcp in Hermes.',
  },
  {
    name: 'Claude',
    icon: '/images/agents/claude-code.svg',
    note: "Claude's Free plan allows one custom connector.",
    steps: [
      'In claude.ai or the desktop app, open "Customize", then "Connectors".',
      'Choose "+ Add", then "Add custom connector".',
      'Name it EarnKit, paste the EarnKit link, choose "Continue".',
      'Keep the connection settings it detected and choose "Continue" again. If it asks for an OAuth client, choose "Register automatically".',
      'Choose "Add". It connects at once. No account needed.',
      'In a chat, choose "+", then "Connectors", and turn EarnKit on.',
    ],
  },
  {
    name: 'Claude Code',
    icon: '/images/agents/claude-code.svg',
    steps: ['Run this in your terminal:'],
    code: `claude mcp add --transport http --scope user earnkit ${MCP_URL}`,
    after: 'Then open Claude Code, type /mcp, pick earnkit, choose Authenticate.',
  },
  {
    name: 'Cursor',
    icon: '/images/agents/cursor.svg',
    install: `cursor://anysphere.cursor-deeplink/mcp/install?name=earnkit&config=${encodeURIComponent(btoa(JSON.stringify({ url: MCP_URL })))}`,
    steps: ['Or add this to ~/.cursor/mcp.json:'],
    code: JSON.stringify(
      { mcpServers: { earnkit: { url: MCP_URL } } },
      null,
      2,
    ),
  },
  {
    name: 'Codex',
    icon: '/images/agents/codex.svg',
    steps: ['Run this in your terminal:'],
    code: `codex mcp add earnkit --url ${MCP_URL}`,
    after: 'Then approve it:',
    afterCode: 'codex mcp login earnkit',
  },
];
