const assets = ['USDC', 'ETH', 'SOL', 'DEGEN', 'AERO'];

export default function Rewards() {
  return (
    <section
      aria-labelledby="rewards"
      className="w-full rounded-[40px] bg-ek-navy px-8 py-20 md:rounded-[56px] md:px-16 md:py-28 lg:px-24"
    >
      <h2
        id="rewards"
        className="max-w-[20ch] font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3rem]"
      >
        Every program pays in its own token.
      </h2>

      <p className="mt-8 max-w-[58ch] font-funnel-sans text-lg font-light leading-[1.6] text-ek-blue-soft md:text-xl">
        A program sets its own reward — a stablecoin, a chain&apos;s native
        currency, or any liquid token its ecosystem already uses. You always see
        what you will actually be paid.
      </p>

      <ul className="mt-12 flex flex-wrap gap-x-8 gap-y-4 md:mt-16 md:gap-x-14">
        {assets.map((a) => (
          <li
            key={a}
            className="font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-blue-bright md:text-4xl"
          >
            {a}
          </li>
        ))}
        <li className="self-end font-funnel-sans text-base font-light text-ek-blue-soft md:text-lg">
          and more
        </li>
      </ul>
    </section>
  );
}
