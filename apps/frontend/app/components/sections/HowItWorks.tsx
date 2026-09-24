import { InstallIcon, CampaignIcon, BoltIcon } from '../ui/Icons';

const steps = [
  {
    icon: InstallIcon,
    title: 'Install EarnKit',
    body: 'Add EarnKit to your agent.',
  },
  {
    icon: CampaignIcon,
    title: 'Join a campaign',
    body: 'Choose something worth building.',
  },
  {
    icon: BoltIcon,
    title: 'Build and earn',
    body: 'Complete the campaign and earn its reward.',
  },
];

export default function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works"
      className="w-full px-4 py-12 md:px-6"
    >
      <h2
        id="how-it-works"
        className="px-4 font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:px-10 md:text-[3rem]"
      >
        Start earning in minutes.
      </h2>

      <div className="mt-10 grid gap-4 md:mt-14 md:grid-cols-3 md:gap-6">
        {steps.map((step) => (
          <div
            key={step.title}
            className="rounded-[32px] bg-ek-navy-deep p-10 md:p-12"
          >
            <step.icon className="h-14 w-14 text-ek-blue-bright" />
            <h3 className="mt-10 font-funnel-display text-2xl font-medium leading-[1.25] text-ek-white md:mt-14">
              {step.title}
            </h3>
            <p className="mt-4 font-funnel-sans text-base font-light leading-[1.6] text-ek-blue-soft md:text-lg">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
