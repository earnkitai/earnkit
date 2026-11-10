import { CARD_NEUTRAL } from '../site/ui';
import { STEPS } from '../../../lib/v5/site-copy';

/**
 * The three steps in one neutral card: an ordered list, a Kaftan numeral and one Funnel Sans line each.
 * Stacked on a phone, three columns from md. No icons, no titles.
 */
export default function Steps() {
  return (
    <section id="how" aria-label="Steps" className={`${CARD_NEUTRAL} p-6 md:p-10`}>
      <ol role="list" className="grid list-none gap-6 md:grid-cols-3 md:gap-10">
        {STEPS.map((text, i) => (
          <li key={text} className="flex items-baseline gap-4 md:flex-col md:items-start md:gap-4">
            <span className="ek-serif w-6 shrink-0 text-[32px] leading-none text-s-step-text md:w-auto md:text-[40px]">{i + 1}</span>
            <span className="text-[17px] leading-snug md:text-[19px]">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
