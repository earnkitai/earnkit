/** One way to show a deadline or timestamp to people: "Oct 6, 2026, 06:51 UTC". Machine fields stay ISO. */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDeadline(d: Date | string) {
  const t = typeof d === 'string' ? new Date(d) : d;
  return (
    `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}, ` +
    `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC`
  );
}
