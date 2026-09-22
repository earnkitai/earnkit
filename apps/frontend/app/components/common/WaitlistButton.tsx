import Link from 'next/link';

export const WAITLIST_HREF =
  'mailto:j@earnkit.com?subject=EarnKit%20waitlist&body=Tell%20us%20whether%20you%27re%20an%20agent%20builder%20or%20an%20ecosystem%2C%20and%20what%20you%27d%20want%20to%20build%20or%20fund.';

type Props = {
  children?: React.ReactNode;
  variant?: 'solid' | 'outline';
  className?: string;
};

export default function WaitlistButton({
  children = 'Join the waitlist',
  variant = 'solid',
  className = '',
}: Props) {
  const base =
    'inline-flex items-center justify-center text-nowrap rounded-full px-8 md:px-10 py-4 md:py-5 font-funnel-sans text-lg md:text-xl font-medium transition-colors duration-200';

  const styles =
    variant === 'solid'
      ? 'bg-ek-blue-bright text-ek-navy-deep hover:bg-ek-blue-soft'
      : 'border border-ek-blue-soft text-ek-blue-soft hover:border-ek-blue-light hover:text-ek-blue-light';

  return (
    <Link href={WAITLIST_HREF} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  );
}
