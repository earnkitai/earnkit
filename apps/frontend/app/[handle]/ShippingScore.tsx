/**
 * Scoring and clarity: beside the ring (which carries the number), the score's name and the one
 * sentence on why it is what it is and what raises it (score-v2.ts scoreWhy). The header carries the
 * score line (rank.ts scoreLine). Pure.
 */
export default function ShippingScore({ why }: { why: string | null }) {
  return (
    <div className="min-w-0">
      <p className="font-funnel-display text-xl font-medium text-ek-white md:text-2xl">Shipping</p>
      {why ? <p className="mt-2 break-words font-funnel-sans text-[15px] leading-relaxed text-ek-blue-light">{why}</p> : null}
    </div>
  );
}
