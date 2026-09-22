import Link from 'next/link';

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: 'solid' | 'outline';
  className?: string;
};

export default function Button({
  href,
  children,
  variant = 'solid',
  className = '',
}: Props) {
  const external = href.startsWith('http') || href.startsWith('mailto:');

  const base =
    'inline-flex items-center justify-center text-nowrap rounded-full px-8 md:px-10 py-4 md:py-5 font-funnel-sans text-lg md:text-xl font-medium transition-colors duration-200';

  const styles =
    variant === 'solid'
      ? 'bg-ek-blue-bright text-ek-navy-deep hover:bg-ek-blue-soft'
      : 'border border-ek-blue-soft text-ek-blue-soft hover:border-ek-blue-light hover:text-ek-blue-light';

  return (
    <Link
      href={href}
      className={`${base} ${styles} ${className}`}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </Link>
  );
}
