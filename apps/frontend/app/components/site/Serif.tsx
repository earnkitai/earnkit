import type { ReactNode } from 'react';

type SerifTag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';

/**
 * v3.1: text in Kaftan Serif (.ek-serif in globals.css: the font, font-size-adjust 0.36, weight 400).
 * Only for names, headlines, big numbers and section titles. `size` is a fixed pixel size; responsive
 * sizes go in `className` (H1_SITE, H2_SITE in ui.ts).
 */
export default function Serif({
  as: Tag = 'span',
  size,
  className = '',
  children,
}: {
  as?: SerifTag;
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`ek-serif leading-none ${className}`.trim()} style={size ? { fontSize: `${size}px` } : undefined}>
      {children}
    </Tag>
  );
}
