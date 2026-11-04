import InstallButton from '../common/InstallButton';
import { PILL_WHITE } from './ui';
import { CTA_INSTALL } from '../../../lib/v5/site-copy';

/**
 * The invite beside a short list (few builders on the leaderboard, a feed week with few rows): an optional Kaftan
 * title, a line of words and the white "Add EarnKit to your agent" pill, which opens the install sheet. `sub` is the
 * line's colour for the surface it sits on (s-muted on the panel, s-card-body on a neutral card; never s-dim on a card).
 * `pill`: the button's classes (the profile's motion-safe variant of PILL_WHITE).
 */
export default function InviteRow({ title, text, sub, className = '', pill = PILL_WHITE }: { title?: string; text: string; sub: string; className?: string; pill?: string }) {
  return (
    <div data-ek-invite="" className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-4 ${className}`}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {title && <p className="ek-serif text-[28px] leading-none text-s-text md:text-[32px]">{title}</p>}
        <p className={`text-[15px] leading-[1.6] ${sub}`}>{text}</p>
      </div>
      <InstallButton label={CTA_INSTALL} className={pill} />
    </div>
  );
}
