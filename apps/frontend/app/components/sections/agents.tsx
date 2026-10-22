// Plain module (no 'use client'): the install steps and Command are read by the modal (client) and by the /docs page (server).
export const MCP_URL = 'https://earnkit.com/mcp';

export type AgentName = 'Grok Bot' | 'Claude' | 'Muse' | 'OpenClaw' | 'Claude Code' | 'Cursor' | 'Codex';

export type Agent = {
  name: AgentName;
  /**
   * The tab's icon, a local file under public/ ("/images/agents/<file>.svg|png"), never fetched from
   * elsewhere. An SVG mark is drawn in one color (the tab's); a PNG is the app's own icon, in color.
   */
  icon: string;
  /** One plain line above the steps (Claude: what a connector is, and the Free plan's limit). */
  note?: string;
  /** One-click install deep link, when the agent supports one. */
  install?: string;
  steps: string[];
  code?: string;
  /** One line after the command (the approve step). */
  after?: string;
  /** A command inside `after` the builder runs too, shown with its own Copy button. */
  afterCode?: string;
};

/**
 * v2.8 Ruling 18 (plan), Ruling C1: the install tabs, Grok Bot first. The editor tab and "Other agents"
 * are gone; the EarnKit link box above the tabs serves any other agent.
 *
 * Icon sources (each the maker's own, stored locally; SVG marks drawn in one color):
 * - grok-bot.png: Grok Bot's own app icon (the macOS app by SpaceXAI, "Copyright © 2026 SpaceXAI"),
 *   dist/renderer/assets/app-icon-*.png inside Grok Bot.app's app.asar (the same art as its
 *   icon.icns), scaled from 256px to 64px. Grok Bot is not Grok: these tabs use its own app icon.
 *   v3.1 S20 (owner decision O5): the landing hero's agent row (app/components/site/AgentMarks.tsx) shows
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
 * then /mcp to sign in); Codex per https://developers.openai.com/codex/mcp
 * (codex mcp add <name> --url <url>, then codex mcp login <name>); OpenClaw per https://docs.openclaw.ai/tools/mcp
 * (openclaw mcp add <name> --url <url> --transport streamable-http, then openclaw mcp login <name>).
 * Claude (claude.ai and the desktop app) per https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 * (install fixes 2026-10-22, the confirmed steps in docs/design-docs-and-implementation-plans/v3.1-install-research.md);
 * its icon is the same Claude Spark as Claude Code's. ChatGPT has no tab: OpenAI's official pages could not be read
 * on 2026-10-22, so its steps are unconfirmed.
 * Grok Bot leads (owner: the most popular), then Claude, then the other personal agents (Muse, OpenClaw); Instinct documents no way to add an MCP server, so it has no tab.
 * Launch-ready L1: Claude Code's line is user scope (EarnKit works in every folder). One-click links only where the
 * agent documents one: Cursor's MCP install deep link (Cursor docs, "Add to Cursor" links:
 * cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the server's config>), shown first in
 * its tab. Claude Code, Codex, Grok Bot, Muse and OpenClaw document none, so none is made up.
 */
export const AGENTS: Agent[] = [
  {
    name: 'Grok Bot',
    icon: '/images/agents/grok-bot.png',
    steps: [
      'Add an MCP connector in Grok Bot.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'Claude',
    icon: '/images/agents/claude-code.svg',
    note: "A connector lets your AI use EarnKit. Claude's Free plan allows one custom connector.",
    steps: [
      'In claude.ai or the desktop app, open "Customize", then "Connectors".',
      'Choose "+ Add", then "Add custom connector".',
      'Name it EarnKit, paste the EarnKit link, choose "Continue".',
      'Choose "Sign in now", then "Add". Sign in with X.',
      'In a chat, choose "+", then "Connectors", and turn EarnKit on.',
    ],
  },
  {
    name: 'Muse',
    icon: '/images/agents/muse.svg',
    steps: [
      'Add a custom integration in Muse.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'OpenClaw',
    icon: '/images/agents/openclaw.svg',
    steps: ['Run this where OpenClaw runs:'],
    code: `openclaw mcp add earnkit --url ${MCP_URL} --transport streamable-http`,
    after: 'Then sign in:',
    afterCode: 'openclaw mcp login earnkit',
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
    after: 'Then sign in:',
    afterCode: 'codex mcp login earnkit',
  },
];

/**
 * A command or config that wraps only between words: a flag like --transport never splits at its hyphens. Lines
 * first (final fix I1): a multi-line block (Cursor's mcp.json) keeps its line breaks and indentation.
 */
export function Command({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, l) => (
        <span key={l}>
          {l > 0 && '\n'}
          {line.split(' ').map((word, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <span className="whitespace-nowrap">{word}</span>
            </span>
          ))}
        </span>
      ))}
    </>
  );
}
