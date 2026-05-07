import Footer from '../components/common/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Earnkit',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      <main className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-4xl whitespace-nowrap md:text-5xl font-bold mb-3 font-title">
            TOKENFI INC. – TERMS & CONDITIONS
          </h1>
          <p className="text-subtle-foreground text-md">
            Last Updated: January 29, 2026
          </p>
        </div>

        {/* Introduction */}
        <div className="mb-12 pb-8 border-b border-border">
          <p className="text-muted-foreground leading-relaxed mb-4">
            These Terms & Conditions (&quot;
            <span className="text-foreground font-semibold">Terms</span>&quot;
            or &quot;
            <span className="text-foreground font-semibold">Agreement</span>
            &quot;) govern your access to and use of all products and services
            operated by{' '}
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
            including but not limited to
            <span className="text-foreground font-semibold">
              {' '}
              tokens.fun
            </span>{' '}
            and <span className="text-foreground font-semibold">
              Minidev
            </span>{' '}
            (collectively, the &quot;
            <span className="text-foreground font-semibold">Platforms</span>
            &quot;).
          </p>
          <p className="text-muted-foreground leading-relaxed">
            By accessing or using any Platform, you agree to be bound by these
            Terms. If you do not agree, you must not use the Platforms.
          </p>
        </div>

        {/* Section 1 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            1. Structure of These Terms
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Certain Platforms are subject to{' '}
            <span className="text-foreground font-semibold">
              product-specific addenda
            </span>
            (&quot;
            <span className="text-foreground font-semibold">
              Product Addenda
            </span>
            &quot;). In the event of any conflict between these Terms and a
            Product Addendum, the Product Addendum shall prevail{' '}
            <span className="text-foreground font-semibold">
              only with respect to that Platform
            </span>
            .
          </p>
        </section>

        {/* Section 2 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            2. Nature of the Platforms (Non-Custodial Disclosure)
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.1 Software-Only Interface
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms provide{' '}
            <span className="text-foreground font-semibold">
              non-custodial software interfaces
            </span>{' '}
            that allow users to interact with third-party decentralized
            protocols and smart contracts.
          </p>
          <p className="text-muted-foreground mb-2">
            TokenFi does{' '}
            <span className="text-foreground font-semibold">not</span>:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>custody digital assets</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>hold private keys or seed phrases</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>execute, settle, or reverse transactions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>operate an exchange or trading venue</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>control liquidity, pricing, or token supply</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            All blockchain transactions occur{' '}
            <span className="text-foreground font-semibold">
              directly between users and third-party protocols
            </span>
            .
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.2 No Financial Institution
          </h3>
          <p className="text-muted-foreground mb-2">
            TokenFi is{' '}
            <span className="text-foreground font-semibold">not</span>:
          </p>
          <ul className="space-y-2 mb-6">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>an exchange</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>a broker or dealer</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>an investment adviser</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>a bank or payment processor</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            Nothing on the Platforms constitutes financial, legal, or tax
            advice.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.3 AI-Powered Features
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms include AI-powered features for application generation
            and AI agent deployment.
          </p>
          <p className="text-muted-foreground mb-2 font-semibold">
            App Generation (Minidev Credits):
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi uses platform API keys to generate applications on your
                behalf
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>You pay credits for generation services</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Generated applications are your property and responsibility
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi does not review, endorse, or guarantee generated code
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2 font-semibold">
            AI Agent Template:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You deploy AI agents using your own third-party API keys
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You are solely responsible for all agent actions, outputs, and
                transactions
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>TokenFi provides hosting infrastructure only</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Agent-generated content, decisions, and transactions are your
                responsibility
              </span>
            </li>
          </ul>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            2.4 Hosting & Infrastructure
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            TokenFi provides hosting infrastructure for applications and AI
            agents deployed through Minidev.
          </p>
          <p className="text-muted-foreground mb-2">You acknowledge that:</p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                hosting is provided &quot;as is&quot; without uptime guarantees
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi may suspend services for maintenance, abuse, or legal
                compliance
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi may access configurations for support, debugging, or
                enforcement
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>data may be backed up but recovery is not guaranteed</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2">
            TokenFi reserves the right to:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>terminate services that violate these Terms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>limit resource usage</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>migrate services to different infrastructure</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>suspend or remove content without notice</span>
            </li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            3. Third-Party Protocols & Fees
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            3.1 Protocol Integrations
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms may integrate with third-party decentralized
            protocols, including but not limited to:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span className="font-semibold underline text-blue-700">
                Doppler SDK
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                <span className="font-semibold underline text-blue-700">
                  Uniswap
                </span>{' '}
                <span className="text-foreground font-semibold no-underline">
                  (including Uniswap v4 pools)
                </span>
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                public blockchains like{' '}
                <span className="font-semibold underline text-blue-700">
                  Base
                </span>
                ,{' '}
                <span className="font-semibold underline text-blue-700">
                  Monad
                </span>{' '}
                <span className="text-foreground font-semibold">and</span>{' '}
                <span className="font-semibold underline text-blue-700">
                  Solana
                </span>
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>AI providers (Anthropic, OpenAI, etc.)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>Social platforms (X/Twitter, Farcaster, etc.)</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            TokenFi does{' '}
            <span className="text-foreground font-semibold">not</span> deploy,
            audit, operate, or control these protocols or services.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            3.2 Fees & Revenue Splits
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Certain interactions may generate{' '}
            <span className="text-foreground font-semibold">
              protocol-level fees
            </span>{' '}
            (e.g., Uniswap pool fees). You acknowledge that:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                fees are enforced by smart contracts or third-party protocols
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                fees may be split between{' '}
                <span className="text-foreground font-semibold">Doppler</span>,{' '}
                <span className="text-foreground font-semibold">Minidev</span>,
                and{' '}
                <span className="text-foreground font-semibold">
                  token creators
                </span>
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi does not guarantee fee amounts, timing, or availability
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                protocol upgrades or governance may alter fee mechanics without
                notice
              </span>
            </li>
          </ul>
        </section>

        {/* Section 4 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            4. Eligibility
          </h2>
          <p className="text-muted-foreground mb-2">
            You represent and warrant that:
          </p>
          <ul className="space-y-2 mb-6">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                you are at least{' '}
                <span className="text-foreground font-semibold">
                  18 years old
                </span>
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>you are legally permitted to use the Platforms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your use does not violate applicable law</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            TokenFi may restrict or terminate access at any time.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            4.1 Geographic Restrictions
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            The Platforms are not available in the following jurisdictions:
          </p>
          <ul className="space-y-2 mb-4">
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
              <span>Crimea, Donetsk, and Luhansk regions of Ukraine</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Any other jurisdiction subject to comprehensive OFAC sanctions
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            We may use IP-based geoblocking and other measures to restrict
            access. Users who circumvent these restrictions do so in violation
            of these Terms and applicable law.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            4.2 United States Users
          </h3>
          <p className="text-muted-foreground mb-2">
            If you are located in the United States:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Tokens created on the Platforms may constitute securities under
                US law
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                You are solely responsible for compliance with SEC, CFTC,
                FinCEN, and state regulations
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi makes no determination as to token classification
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi does not provide legal, tax, or investment advice
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Certain features may be unavailable to US users at
                TokenFi&apos;s discretion
              </span>
            </li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            5. No Investment Advice; No Securities Representation
          </h2>
          <p className="text-muted-foreground mb-2">
            TokenFi does{' '}
            <span className="text-foreground font-semibold">not</span>:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>recommend tokens or strategies</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>represent that any token is or is not a security</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>guarantee utility, value, or performance</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Token classification depends on user conduct and jurisdiction.
            <br />
            <span className="text-foreground font-semibold">
              You assume all regulatory and compliance risk
            </span>
            .
          </p>
        </section>

        {/* Section 6 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            6. User Responsibilities
          </h2>
          <p className="text-muted-foreground mb-2">
            You are solely responsible for:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your wallet security</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>reviewing smart contracts you interact with</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                reviewing code generated by AI tools before deployment
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>monitoring AI agents you deploy</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>complying with laws applicable to you</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                losses resulting from your actions or your agents&apos; actions
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Blockchain transactions are{' '}
            <span className="text-foreground font-semibold">irreversible</span>.
          </p>
        </section>

        {/* Section 7 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            7. Prohibited Activities
          </h2>
          <p className="text-muted-foreground mb-2">
            You may not use the Platforms to:
          </p>
          <ul className="space-y-2 mb-6">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>violate any law or regulation</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>engage in fraud, deception, or misrepresentation</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                create tokens that impersonate others or infringe trademarks
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>launder money or finance unlawful activity</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>evade sanctions or export controls</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>exploit vulnerabilities or misuse the Platforms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>infringe intellectual property or privacy rights</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>harass, abuse, or harm others</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                manipulate markets (wash trading, pump-and-dump, etc.)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>deploy agents that engage in prohibited activities</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>generate illegal, harmful, or abusive content</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            TokenFi may restrict access for violations without notice or refund.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            7.1 Content Moderation
          </h3>
          <p className="text-muted-foreground mb-2">
            TokenFi reserves the right to:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>review content generated by AI tools or agents</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                remove or disable access to content that violates these Terms
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>suspend services that produce prohibited content</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>comply with valid legal requests or takedown notices</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>report illegal activity to authorities</span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2">
            Prohibited content includes:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>illegal content in any jurisdiction</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>content that infringes intellectual property</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>malicious code or security exploits</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>content that violates third-party terms of service</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>harassment, abuse, or threats</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>child sexual abuse material (zero tolerance)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>content promoting violence or terrorism</span>
            </li>
          </ul>
        </section>

        {/* Section 8 - Important callout */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            8. Compliance, Sanctions & Unlawful Use
          </h2>
          <div className="bg-secondary border border-border rounded-xl p-6 mb-4">
            <p className="text-muted-foreground leading-relaxed mb-3">
              The Platforms are provided as{' '}
              <span className="font-semibold text-foreground">
                non-custodial software interfaces only
              </span>
              . TokenFi does not provide custodial services, process fiat
              currency, or execute transactions on behalf of users. Accordingly,
              TokenFi does{' '}
              <span className="font-semibold text-foreground">not</span> conduct
              customer due diligence, identity verification, or transaction
              monitoring.
            </p>
          </div>
          <p className="text-muted-foreground mb-2">
            You represent and warrant that:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>you are not subject to economic or trade sanctions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                you are not located in, incorporated in, or a resident of any
                sanctioned jurisdiction
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                you are not using the Platforms for money laundering, terrorist
                financing, or unlawful purposes
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>funds you use do not derive from illegal activity</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-3">
            TokenFi reserves the right, in its sole discretion, to restrict or
            block access to the Platforms, limit functionality, comply with
            applicable sanctions, laws, or lawful requests, cooperate with law
            enforcement or regulatory authorities, and freeze or restrict
            accounts pending investigation.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Nothing in these Terms obligates TokenFi to monitor transactions,
            identify users, or report activity, except where required by law.
          </p>
        </section>

        {/* Section 9 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            9. Intellectual Property
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            9.1 Platform IP
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-6">
            All Platform software, interfaces, branding, and content (excluding
            user-generated content) are owned by TokenFi or its licensors.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-6">
            You are granted a{' '}
            <span className="font-semibold text-foreground">limited</span>,{' '}
            <span className="font-semibold text-foreground">revocable</span>,{' '}
            <span className="font-semibold text-foreground">
              non-transferable
            </span>{' '}
            license to use the Platforms for lawful purposes.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            9.2 User-Generated Content & Applications
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Applications and content you create using Minidev are your property.
          </p>
          <p className="text-muted-foreground mb-2">
            However, you grant TokenFi a non-exclusive, worldwide, royalty-free
            license to:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>host and serve your applications</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                display your applications in showcases or marketing (with
                attribution)
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>analyze usage for platform improvement</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            You represent that content you create does not infringe third-party
            rights.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            9.3 AI-Generated Code
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-2">
            Code generated by AI tools may:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>be similar to code generated for other users</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>incorporate patterns from training data</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                not be eligible for copyright protection in some jurisdictions
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            TokenFi makes no warranties regarding the originality or
            intellectual property status of AI-generated code.
          </p>
        </section>

        {/* Section 10 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            10. Termination
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            TokenFi may suspend or terminate access to the Platforms at any
            time, for any reason, without notice.
          </p>
          <p className="text-muted-foreground mb-2">
            Because the Platforms are non-custodial:
          </p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>TokenFi cannot seize or control your on-chain assets</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                termination affects{' '}
                <span className="font-semibold text-foreground">
                  interface and hosting access only
                </span>
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                you remain responsible for on-chain assets and deployed
                contracts
              </span>
            </li>
          </ul>
          <p className="text-muted-foreground mb-2">Upon termination:</p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your right to use the Platforms ceases immediately</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>AI agents may be shut down</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>hosted applications may be taken offline</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>credits are non-refundable</span>
            </li>
          </ul>
        </section>

        {/* Section 11 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            11. Disclaimers
          </h2>
          <div className="bg-gray-100 border border-border rounded-xl p-6">
            <p className="text-foreground font-semibold mb-3">
              THE PLATFORMS ARE PROVIDED &quot;
              <span className="font-semibold text-foreground">
                AS IS
              </span>&quot;{' '}
              <span className="font-semibold text-foreground">AND</span> &quot;
              <span className="font-semibold text-foreground">
                AS AVAILABLE
              </span>
              .&quot;
            </p>
            <p className="text-muted-foreground mb-2">
              TOKENFI DISCLAIMS ALL WARRANTIES, INCLUDING:
            </p>
            <ul className="space-y-2 mb-3">
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>merchantability</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>fitness for a particular purpose</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>non-infringement</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>accuracy, reliability, or availability</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>security or error-free operation</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>AI output quality or correctness</span>
              </li>
            </ul>
            <p className="text-muted-foreground mb-3">
              AI-GENERATED CONTENT MAY CONTAIN ERRORS, BUGS, VULNERABILITIES, OR
              INAPPROPRIATE CONTENT. YOU ARE RESPONSIBLE FOR REVIEWING ALL AI
              OUTPUTS.
            </p>
            <p className="text-muted-foreground">Use is at your own risk.</p>
          </div>
        </section>

        {/* Section 12 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            12. Limitation of Liability
          </h2>
          <p className="text-muted-foreground mb-2">
            To the maximum extent permitted by law:
          </p>
          <ul className="space-y-2 mb-3">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for indirect, incidental, special, or
                consequential damages
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for loss of funds, profits, data, or
                goodwill
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for third-party protocol failures
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for AI errors, hallucinations, or
                misbehavior
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for actions taken by AI agents you deploy
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                TokenFi is not liable for regulatory action against you
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>
                Total liability shall not exceed{' '}
                <span className="font-semibold text-foreground">
                  fees actually paid to TokenFi in the preceding 12 months, or
                  $100 USD, whichever is greater
                </span>
              </span>
            </li>
          </ul>
        </section>

        {/* Section 13 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            13. Indemnification
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-2">
            You agree to indemnify, defend, and hold harmless TokenFi, its
            affiliates, officers, directors, employees, contractors, and agents
            from any claims, damages, losses, liabilities, costs, and expenses
            (including reasonable attorneys&apos; fees) arising from:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your use of the Platforms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>violations of these Terms</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your applications or content</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>actions of AI agents you deploy</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>tokens you create</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>interactions with third-party protocols</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>your violation of any law or third-party rights</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>disputes with other users</span>
            </li>
          </ul>
        </section>

        {/* Section 14 - Critical */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            14. Dispute Resolution & Arbitration
          </h2>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            14.1 Mandatory Pre-Arbitration Resolution
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-6">
            You agree to first notify TokenFi of any dispute and engage in
            good-faith efforts to resolve it. If unresolved within{' '}
            <span className="font-semibold text-foreground">
              ninety (90) days
            </span>
            , either party may initiate arbitration.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            14.2 Binding Arbitration
          </h3>
          <div className="bg-secondary border-l-4 border-primary rounded-r-xl p-6 mb-4">
            <p className="text-muted-foreground leading-relaxed mb-3">
              All disputes arising out of or relating to these Terms or the
              Platforms shall be resolved{' '}
              <span className="font-semibold text-foreground">
                exclusively by final and binding arbitration
              </span>
              .
            </p>
            <ul className="space-y-2">
              <li className="flex items-start text-muted-foreground">
                <span className="text-foreground font-semibold mr-2">
                  Institution:
                </span>
                <span>Gujarat Chamber of Commerce & Industries (GCCI)</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="text-foreground font-semibold mr-2">
                  Rules:
                </span>
                <span>GCCI Arbitration Rules (incorporated by reference)</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="text-foreground font-semibold mr-2">
                  Seat / Legal Place:
                </span>
                <span>Ahmedabad, India</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="text-foreground font-semibold mr-2">
                  Language:
                </span>
                <span>English</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="text-foreground font-semibold mr-2">
                  Arbitrator:
                </span>
                <span>Sole arbitrator appointed per GCCI bye-laws</span>
              </li>
            </ul>
          </div>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            14.3 Fallback Jurisdiction
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-6">
            For users in jurisdictions where the above arbitration clause is
            unenforceable, disputes shall be resolved exclusively in the state
            or federal courts of Delaware, USA.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            14.4 Waivers
          </h3>
          <p className="text-muted-foreground mb-2">You waive:</p>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>court proceedings (except as provided above)</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>jury trials</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>class actions or representative actions</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
              <span>consolidated arbitration</span>
            </li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-6">
            Arbitration is confidential, except as required to enforce an award
            or comply with law.
          </p>

          <h3 className="text-lg font-semibold mb-3 text-foreground">
            14.5 Governing Law
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            These Terms are governed by the{' '}
            <span className="font-semibold text-foreground">laws of India</span>{' '}
            for arbitration matters, and the{' '}
            <span className="font-semibold text-foreground">
              laws of Delaware, USA
            </span>{' '}
            for all other matters.
          </p>
        </section>

        {/* Section 15 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">15. General</h2>
          <ul className="space-y-2">
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                Severability:
              </span>
              <span>
                Invalid provisions are severed without affecting the rest
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                Assignment:
              </span>
              <span>TokenFi may assign these Terms freely; you may not</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                Electronic Communications:
              </span>
              <span>You consent to electronic notices</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                No Waiver:
              </span>
              <span>Failure to enforce any right is not a waiver</span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                Entire Agreement:
              </span>
              <span>
                These Terms, together with Product Addenda, Risk Disclosure,
                Privacy Policy, and Token Creator Agreement, constitute the
                entire agreement
              </span>
            </li>
            <li className="flex items-start text-muted-foreground">
              <span className="text-foreground text-nowrap font-semibold mr-2">
                Force Majeure:
              </span>
              <span>
                TokenFi is not liable for failures due to circumstances beyond
                its control
              </span>
            </li>
          </ul>
        </section>

        {/* Section 16 - Final acknowledgement */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-position">
            16. Acknowledgement
          </h2>
          <div className="bg-secondary border border-border rounded-xl p-6">
            <p className="text-muted-foreground leading-relaxed mb-3">
              By using the Platforms, you acknowledge that:
            </p>
            <ul className="space-y-2 mb-4">
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>you understand and accept these Terms</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>you have read the Risk Disclosure</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>arbitration is the exclusive dispute forum</span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>
                  you assume all risks associated with digital assets and AI
                  tools
                </span>
              </li>
              <li className="flex items-start text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0"></span>
                <span>
                  you are responsible for your own legal and tax compliance
                </span>
              </li>
            </ul>
            <p className="text-muted-foreground">
              <span className="text-foreground font-semibold">
                IF YOU DO NOT AGREE, DO NOT USE THE PLATFORMS.
              </span>
            </p>
          </div>
        </section>

        {/* Contact Section */}
        <section className="mb-10 pb-8 border-t border-border italic pt-8">
          <p className="text-muted-foreground">TokenFi Inc. - Delaware, USA</p>
          <p className="text-muted-foreground">
            Contact:{' '}
            <a
              href="mailto:j@earnkit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary"
            >
              j@earnkit.com
            </a>
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
