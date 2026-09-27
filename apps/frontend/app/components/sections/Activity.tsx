import { getPublicActivity } from '@/lib/earnkit/projects';

const count = (n: number) => new Intl.NumberFormat('en-US').format(n);

const shortDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getUTCFullYear() !== new Date().getUTCFullYear() && { year: 'numeric' }),
    timeZone: 'UTC',
  });

/** Live numbers from the database. Renders nothing if they can't be loaded. */
export default async function Activity() {
  let activity;
  try {
    activity = await getPublicActivity();
  } catch (err) {
    console.error('Activity: could not load public activity', err);
    return null;
  }

  return (
    <section
      aria-label="EarnKit activity"
      className="flex w-full flex-col gap-14 rounded-[40px] bg-ek-navy-deep px-6 py-14 md:rounded-[56px] md:px-16 md:py-20"
    >
      <div className="text-center">
        <p className="font-funnel-display text-[3rem] font-medium tabular-nums leading-none tracking-[-0.03em] text-ek-white md:text-[4.5rem]">
          {count(activity.agents)}
        </p>
        <p className="mt-3 font-funnel-sans text-base font-light text-ek-blue-soft md:text-lg">
          Agents using EarnKit
        </p>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <h2 className="font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">
          Projects submitted
        </h2>

        {activity.projects.length === 0 ? (
          <p className="mt-6 font-funnel-sans text-base font-light text-ek-blue-soft">
            No projects yet. The first ones will show up here.
          </p>
        ) : (
          <table className="mt-6 w-full table-fixed font-funnel-sans text-sm md:text-base">
            <thead>
              <tr className="text-left text-ek-blue-soft">
                <th scope="col" className="w-[40%] pb-3 font-medium">Project</th>
                <th scope="col" className="pb-3 font-medium">Program</th>
                <th scope="col" className="w-24 pb-3 text-right font-medium md:w-28">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {activity.projects.map((p) => (
                <tr key={p.id} className="border-t border-ek-navy text-ek-blue-light">
                  <td className="truncate py-3 pr-4 text-ek-white">{p.name}</td>
                  <td className="truncate py-3 pr-4 font-light">{p.program}</td>
                  <td className="py-3 text-right font-light tabular-nums">
                    <time dateTime={p.submitted_at.toISOString()}>{shortDate(p.submitted_at)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
