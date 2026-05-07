import Footer from '../components/common/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Earnkit',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      <main className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 font-title">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground text-md">
            Last Updated: January 29, 2026
          </p>
        </div>

        {/* Introduction */}
        <div className="mb-12 pb-8 border-b border-border">
          <p className="text-muted-foreground leading-relaxed mb-4">
            This Privacy Policy (&quot;
            <span className="text-foreground font-semibold">Policy</span>&quot;)
            explains how{' '}
            <strong className="text-foreground font-semibold">
              TokenFi Inc.
            </strong>
            , a Delaware corporation (&quot;
            <span className="text-foreground font-semibold">TokenFi</span>
            ,&quot; &quot;
            <span className="text-foreground font-semibold">we</span>,&quot;
            &quot;<span className="text-foreground font-semibold">us</span>
            ,&quot; or &quot;
            <span className="text-foreground font-semibold">our</span>&quot;),
            collects, uses, discloses, and protects information in connection
            with your use of our products and services, including{' '}
            <span className="text-foreground font-semibold">tokens.fun</span>{' '}
            and <span className="text-foreground font-semibold">Minidev</span>{' '}
            (collectively, the &quot;
            <span className="text-foreground font-semibold">Platforms</span>
            &quot;).
          </p>
          <div className="bg-secondary border border-border rounded-xl p-4">
            <p className="text-muted-foreground text-sm font-medium">
              By accessing or using the Platforms, you acknowledge that you have
              read and understood this Policy.
            </p>
          </div>
        </div>

        {/* Section 1 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">1. Scope</h2>
          <p className="text-muted-foreground mb-2">
            This Policy applies to information collected through:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>our websites and applications</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>wallet connections and interactions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>AI-powered features and agents</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>analytics and telemetry</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>communications with us</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2">
            This Policy does{' '}
            <span className="text-foreground font-semibold">not</span> apply to:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                public blockchain data recorded on decentralized networks
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                third-party websites, wallets, protocols, or services (e.g.,
                Uniswap, Doppler, Farcaster, Anthropic)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>content you make publicly available</span>
            </li>
          </ul>
        </section>

        {/* Section 1A - NEW */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            1A. Geographic Restrictions
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms are not intended for users in:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>North Korea</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Iran</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Syria</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Cuba</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Russia</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Crimea, Donetsk, and Luhansk regions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Other OFAC-sanctioned territories</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            We may use IP-based geoblocking and decline to process data from
            restricted regions.
          </p>
        </section>

        {/* Section 2 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            2. Information We Collect
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.1 Information You Provide
          </h3>
          <p className="text-muted-foreground mb-2">
            We may collect information you voluntarily provide, including:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>email address</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>username or display name</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>messages, feedback, or support requests</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>application content and configurations</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>other information you choose to provide</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm italic mb-6">
            You are not required to provide real names to use the Platforms.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.2 Wallet & Blockchain Information
          </h3>
          <p className="text-muted-foreground mb-2">
            When you connect a wallet or interact with blockchain features, we
            may collect:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>public wallet addresses</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>blockchain network identifiers</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>transaction hashes initiated through our interfaces</span>
            </li>
          </ul>
          <div className="bg-secondary border-l-4 border-primary rounded-r-xl p-4 mb-6">
            <p className="text-foreground font-semibold text-sm">
              We do not collect private keys, seed phrases, or signing
              credentials.
            </p>
          </div>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.3 Automatically Collected Information
          </h3>
          <p className="text-muted-foreground mb-2">
            We may automatically collect certain information, including:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>IP address</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>device type, browser, and operating system</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>usage data (pages viewed, actions taken)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>timestamps and system logs</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>error reports and crash data</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm mb-6">
            This information is used for security, analytics, and platform
            improvement.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.4 Cookies & Similar Technologies
          </h3>
          <p className="text-muted-foreground mb-2">
            We may use cookies, local storage, or similar technologies to:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>remember preferences</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>improve performance</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>understand usage patterns</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>prevent fraud and abuse</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm mb-6">
            You can control cookies through your browser settings.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.5 AI App Generation Data
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            When you create applications using Minidev credits:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                We process your prompts using our platform API keys with
                third-party AI providers (e.g., Anthropic)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Prompts may be sent to AI providers subject to their privacy
                policies
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>We may retain prompts and generated code for:</span>
            </li>
          </ul>
          <ul className="space-y-2 mb-3 ml-8">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>providing the service</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>debugging and support</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>platform improvement</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>abuse prevention</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            We do not sell your prompts or generated code.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.6 AI Agent Template Data
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            If you deploy an AI agent using the Agent Template:
          </p>
          <p className="text-muted-foreground mb-2 font-semibold">
            API Keys You Provide:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You provide your own third-party API keys (e.g., Anthropic,
                X/Twitter, trading APIs)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Your keys are stored encrypted at rest</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Keys are used solely to operate your agent on your behalf
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                We do not share your keys with other users or use them for our
                purposes
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>You can revoke or delete keys at any time</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2 font-semibold">
            Agent Data:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Agent configuration and settings</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Agent memory and conversation context</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Agent action logs and transaction history</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Content generated by your agent</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2 font-semibold">Retention:</p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Agent data is retained while your agent is active</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Upon termination, data is deleted within 30 days</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Blockchain transactions are permanent and outside our control
              </span>
            </li>
          </ul>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.7 Payment & Credit Data
          </h3>
          <p className="text-muted-foreground mb-2">
            When you purchase credits:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>We record transaction amounts and timestamps</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Blockchain payment addresses and transaction hashes</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Credit balances and usage history</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm">
            We do not store full payment card details (if applicable, handled by
            payment processors).
          </p>
        </section>

        {/* Section 3 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            3. How We Use Information
          </h2>
          <p className="text-muted-foreground mb-2">We use information to:</p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>operate and maintain the Platforms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>enable wallet connections and user interactions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>generate applications and host AI agents</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>process credit purchases and usage</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>improve features, performance, and user experience</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>monitor security, prevent abuse, and debug issues</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>communicate updates, notices, or responses</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>comply with legal obligations</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>enforce our Terms</span>
            </li>
          </ul>
          <div className="bg-secondary border border-border rounded-xl p-4">
            <p className="text-foreground text-sm font-semibold">
              We do not sell personal data.
            </p>
          </div>
        </section>

        {/* Section 4 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            4. Legal Bases for Processing
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Where applicable (including under GDPR or India&apos;s DPDP Act), we
            process personal data based on:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your consent</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>performance of a contract</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                legitimate interests (e.g., security, analytics, abuse
                prevention)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>compliance with legal obligations</span>
            </li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            5. Disclosure of Information
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            5.1 Service Providers
          </h3>
          <p className="text-muted-foreground mb-2">
            We may share information with third-party service providers that
            assist us with:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>hosting and infrastructure (e.g., AWS, Vercel)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                AI services (e.g., Anthropic) - for app generation only
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>analytics and monitoring</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>customer support tools</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm mb-6">
            These providers are contractually restricted from using information
            for other purposes.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            5.2 AI Providers
          </h3>
          <p className="text-muted-foreground mb-3">
            <span className="font-semibold">For App Generation:</span> Your
            prompts are sent to AI providers (e.g., Anthropic) using our API
            keys. These providers have their own privacy policies.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-6">
            <span className="font-semibold">For Agent Template:</span> Your
            prompts are sent using YOUR API keys directly. We facilitate the
            connection but you have a direct relationship with the AI provider.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            5.3 Legal & Regulatory Disclosures
          </h3>
          <p className="text-muted-foreground mb-2">
            We may disclose information if required to:
          </p>
          <ul className="space-y-2 mb-6">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>comply with law, regulation, or legal process</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>respond to lawful requests from authorities</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                protect the rights, safety, or integrity of TokenFi or others
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>investigate suspected fraud or abuse</span>
            </li>
          </ul>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            5.4 Business Transfers
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            If TokenFi Inc. is involved in a merger, acquisition,
            reorganization, or asset sale, information may be transferred as
            part of that transaction.
          </p>
        </section>

        {/* Section 6 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            6. Blockchain Data Disclaimer
          </h2>
          <div className="bg-secondary border border-border rounded-xl p-6">
            <p className="text-muted-foreground mb-3">
              Blockchain networks are{' '}
              <span className="text-foreground font-semibold">
                public by design
              </span>
              .
            </p>
            <p className="text-muted-foreground mb-2">
              Information recorded on public blockchains:
            </p>
            <ul className="space-y-2 mb-3">
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>is not controlled by TokenFi</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>cannot be modified or deleted by us</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>falls outside the scope of this Policy</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>is permanently visible to anyone</span>
              </li>
            </ul>
            <p className="text-muted-foreground text-sm">
              This includes wallet addresses, transaction amounts, token
              holdings, and smart contract interactions.
            </p>
          </div>
        </section>

        {/* Section 7 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            7. Data Retention
          </h2>
          <p className="text-muted-foreground mb-2">
            We retain personal data only for as long as:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>necessary for the purposes described in this Policy</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>required by law</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                reasonably necessary for security, dispute resolution, or
                enforcement
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2 font-semibold">
            Specific retention periods:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Account data: Duration of account plus 2 years</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Agent data: Duration of deployment plus 30 days</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Usage logs: 1 year</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Support communications: 3 years</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm">
            Aggregated or anonymized data may be retained indefinitely.
          </p>
        </section>

        {/* Section 8 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            8. Data Security
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            We implement reasonable technical and organizational measures to
            protect information, including:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>encryption at rest and in transit</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>access controls and authentication</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>regular security reviews</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>incident response procedures</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2">However:</p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>no system is completely secure</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>we cannot guarantee absolute security</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>you are responsible for your own account security</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm italic mb-6">
            You use the Platforms at your own risk.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            8.1 API Key Security
          </h3>
          <p className="text-muted-foreground mb-2">
            For AI Agent Template users:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                API keys are encrypted at rest using industry-standard
                encryption
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Access to keys is restricted to essential systems</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Keys are never logged in plaintext</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You should use keys with appropriate permission scopes
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You should monitor your API provider dashboards for unusual
                activity
              </span>
            </li>
          </ul>
        </section>

        {/* Section 9 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            9. Your Rights
          </h2>
          <p className="text-muted-foreground mb-2">
            Depending on your jurisdiction, you may have rights to:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>access your personal data</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>correct inaccurate data</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>request deletion</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>restrict or object to processing</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>data portability</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>withdraw consent</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2 font-semibold">
            Limitations:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>We cannot delete blockchain data</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Some data may be retained for legal compliance</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Deletion may require terminating services</span>
            </li>
          </ul>
          <div className="bg-secondary border border-border rounded-xl p-4 mb-3">
            <p className="text-muted-foreground">
              To exercise your rights, contact us at:{' '}
              <a
                href="mailto:j@earnkit.com"
                className="text-primary font-semibold hover:underline"
              >
                j@earnkit.com
              </a>
            </p>
          </div>
          <p className="text-subtle-foreground text-sm">
            We will respond within 30 days (or as required by applicable law).
          </p>
        </section>

        {/* Section 10 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            10. International Data Transfers
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Your information may be processed in jurisdictions other than your
            own, including the United States and India.
          </p>
          <p className="text-subtle-foreground text-sm">
            We take reasonable steps to ensure appropriate safeguards where
            required, including standard contractual clauses where applicable.
          </p>
        </section>

        {/* Section 11 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            11. Children&apos;s Privacy
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms are{' '}
            <span className="text-foreground font-semibold">
              not intended for individuals under 18 years of age
            </span>
            .
          </p>
          <p className="text-muted-foreground leading-relaxed">
            We do not knowingly collect personal data from children. If we learn
            we have collected data from a child, we will delete it promptly.
          </p>
        </section>

        {/* Section 12 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            12. Third-Party Links & Services
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms may contain links to third-party websites or integrate
            with third-party services.
          </p>
          <p className="text-muted-foreground mb-2">
            We are{' '}
            <span className="text-foreground font-semibold">
              not responsible
            </span>{' '}
            for their privacy practices. This includes:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>AI providers (Anthropic, OpenAI)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Social platforms (X/Twitter, Farcaster)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Blockchain protocols (Uniswap, Doppler)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Wallet providers</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm">
            Review their privacy policies before use.
          </p>
        </section>

        {/* Section 13 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            13. Do Not Track
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            We do not currently respond to &quot;Do Not Track&quot; browser
            signals.
          </p>
        </section>

        {/* Section 14 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            14. Changes to This Policy
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            We may update this Policy from time to time.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Changes will be reflected by updating the &quot;Last Updated&quot;
            date.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-3">
            For material changes, we will provide notice through the Platforms
            or by email.
          </p>
          <p className="text-subtle-foreground text-sm">
            Continued use of the Platforms after changes constitutes acceptance
            of the revised Policy.
          </p>
        </section>

        {/* Section 15 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            15. Contact Information
          </h2>
          <div className="bg-secondary border border-border rounded-xl p-6">
            <p className="text-muted-foreground mb-3">
              If you have questions or concerns about this Policy, contact:
            </p>
            <p className="text-foreground font-semibold mb-1">TokenFi Inc.</p>
            <p className="text-muted-foreground mb-1">
              Email:{' '}
              <a
                href="mailto:j@earnkit.com"
                className="text-primary font-semibold hover:underline"
              >
                j@earnkit.com
              </a>
            </p>
            <p className="text-subtle-foreground text-sm mt-3">
              For privacy-specific requests, use subject line: &quot;Privacy
              Request&quot;
            </p>
          </div>
        </section>

        {/* Section 16 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            16. Relationship to Other Terms
          </h2>
          <p className="text-muted-foreground mb-2">This Policy supplements:</p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>TokenFi Inc. Terms & Conditions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Risk Disclosure</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Token Creator Agreement</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>AI Agent Addendum (if applicable)</span>
            </li>
          </ul>
          <p className="text-subtle-foreground text-sm">
            In the event of a conflict, the{' '}
            <a href="/terms">
              <span className="text-foreground font-semibold">
                Terms & Conditions
              </span>
            </a>{' '}
            govern contractual matters.
          </p>
        </section>

        {/* Footer Note */}
        <section className="mb-10 pb-8 border-t border-border pt-8">
          <p className="text-muted-foreground italic">
            TokenFi Inc. - Delaware, USA
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
