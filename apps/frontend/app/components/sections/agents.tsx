// Plain module (no 'use client'): read by the install sheet (client) and the /docs page (server).
export * from '../../../lib/v5/agents';

/**
 * A command or config that wraps only between words: a flag like --transport never splits at its hyphens. Lines
 * first: a multi-line block (Cursor's mcp.json) keeps its line breaks and indentation.
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
