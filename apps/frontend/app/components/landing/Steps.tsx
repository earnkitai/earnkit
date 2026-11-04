import { STEPS, STEPS_TITLE } from '../../../lib/v5/site-copy';
import { H2_SITE } from '../site/ui';

/** The three line icons from the Landing board (24px grid): a plug, a rocket, two rounds. */
const ICONS: [string, string, string][] = [
  ['M12 22v-5', 'M9 8V2M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
  [
    'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z',
    'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z',
    'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  ],
  ['M8 2a6 6 0 1 0 0 12 6 6 0 1 0 0-12', 'M18.09 10.37A6 6 0 1 1 10.34 18', 'M7 6h1v4M16.71 13.88l.7.71-2.82 2.82'],
];

/** The three steps on cards. Every icon sits in the same 56px box, so the titles share one line. */
export default function Steps() {
  return (
    <section id="how" aria-labelledby="how-title" className="flex flex-col gap-8">
      <h2 id="how-title" className={`${H2_SITE} px-2`}>
        {STEPS_TITLE}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {STEPS.map(([title, text], i) => (
          <div
            key={title}
            className="flex min-h-[220px] flex-col gap-3.5 rounded-[28px] border border-s-step-line bg-gradient-to-b from-s-step-top to-s-step-bottom p-6 text-s-text md:min-h-[260px] md:rounded-[36px] md:p-8"
          >
            <svg data-ek-step-icon="" width="56" height="56" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block h-14 w-14 shrink-0 stroke-s-icon-blue">
              {ICONS[i].map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            <h3 className="ek-serif mt-8 text-[32px] leading-none md:text-[40px]">{title}</h3>
            <p className="text-[16px] leading-normal text-s-step-text">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
