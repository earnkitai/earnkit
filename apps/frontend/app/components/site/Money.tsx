/** A currency sign: dollar, euro, pound, yen, rupee, won. */
const SIGN = /([$€£¥₹₩])/;

/**
 * Money (and $TICKER) text whose currency signs are drawn in Funnel Sans: Kaftan Serif's "$" reads as an "S" at
 * small sizes. The digits and letters keep the parent's font (Kaftan in a big number); the sign inherits the size
 * and font-size-adjust, so it sits at the digits' height. Server-safe; plain text without a sign renders as is.
 */
export default function Money({ text }: { text: string }) {
  const parts = text.split(SIGN);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} data-ek-sign="" className="font-funnel-sans font-normal">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
