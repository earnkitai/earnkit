type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function InstallIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4v9" />
      <path d="m8.5 10 3.5 3.5L15.5 10" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function CampaignIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.6 4L17 12H5" />
    </svg>
  );
}

export function BoltIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 2 6 13h5l-2 9 9-13h-5l0-7Z" />
    </svg>
  );
}

export function TargetIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EvaluateIcon({ className = '' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.5 2.4 2.4 4.6-5.3" />
    </svg>
  );
}
