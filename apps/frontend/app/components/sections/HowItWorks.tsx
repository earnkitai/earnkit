import Image from 'next/image';
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

/**
 * The orange world from the Figma landing: ember panels, glowing amber
 * icons, brown cards. This is the page's blue-to-orange switch.
 */
export default function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works"
      className="w-full px-4 py-12 md:px-6"
    >
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <div className="flex flex-col justify-center rounded-[40px] bg-ek-ember px-10 py-16 md:rounded-[56px] md:px-16 md:py-0">
          <h2
            id="how-it-works"
            className="max-w-[13ch] font-funnel-display text-[2rem] font-semibold leading-[1.2] text-ek-amber md:text-[3.25rem]"
          >
            Start earning in minutes.
          </h2>
        </div>

        <div className="relative aspect-[756/800] overflow-hidden rounded-[40px] bg-ek-ember md:rounded-[56px]">
          <Image
            src="/images/graphics/icon-grid.png"
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:mt-6 md:grid-cols-3 md:gap-6">
        {steps.map((step) => (
          <div
            key={step.title}
            className="rounded-[32px] bg-ek-card-brown p-10 md:p-12"
          >
            <step.icon className="h-16 w-16 text-ek-amber [filter:drop-shadow(0_0_14px_rgba(252,158,25,0.55))]" />
            <h3 className="mt-10 font-funnel-display text-2xl font-semibold leading-[1.25] text-ek-amber md:mt-14">
              {step.title}
            </h3>
            <p className="mt-4 font-funnel-sans text-base font-light leading-[1.6] text-ek-cream md:text-lg">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
