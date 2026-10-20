import { Panel } from '../../components/common/Panel';

/**
 * Tokenfi Inc.'s risk disclosure for tokens.fun, Minidev and related services (/terms#risk-disclosure
 * since v2.9 F22; was /risk-disclosure). The legal text is unchanged; only its styling moved to
 * the site's panels.
 */
export default function RiskSection() {
  return (
    <Panel className="py-12 md:py-16" label="Risk disclosure">
      <div className="max-w-4xl font-funnel-sans text-base font-light">
        {/* Header */}
        <div className="mb-12">
          <h2 id="risk-disclosure" className="mb-3 scroll-mt-32 font-funnel-display text-2xl font-medium text-ek-text md:text-4xl">
            Risk disclosure
          </h2>
          <p className="text-ek-muted text-md">
            Last updated: January 29, 2026
          </p>
        </div>

        {/* Intro */}
        <div className="mb-12 pb-8 border-b border-ek-line">
          <p className="text-ek-body leading-relaxed mb-4">
            This Risk Disclosure is provided by{' '}
            <span className="font-semibold text-ek-text">TokenFi Inc.</span>{' '}
            (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) to inform users of the material risks
            associated with using tokens.fun, Minidev, and related services (the
            &quot;Platforms&quot;). By accessing or using the Platforms, you acknowledge
            that you have read, understood, and accepted the risks described
            below.
          </p>
          <p className="text-ek-body leading-relaxed mb-4">
            This disclosure does{' '}
            <span className="font-semibold text-ek-text">not</span> describe
            all possible risks. You should not use the Platforms unless you
            fully understand and are willing to accept the possibility of{' '}
            <span className="font-semibold text-ek-text">total loss</span>.
          </p>
        </div>

        {/* Section 1 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            1. GENERAL NATURE OF THE PLATFORMS
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            tokens.fun is a{' '}
            <span className="font-semibold text-ek-text">
              non-custodial software interface
            </span>{' '}
            that enables users to interact with third-party smart contracts and
            decentralized protocols to create and trade ERC-20 tokens
            (&quot;Tokens&quot;).
          </p>

          <p className="text-ek-body leading-relaxed mb-6">
            Minidev is an AI-powered platform for creating web applications and
            deploying AI agents.
          </p>

          <p className="text-ek-body mb-4 font-medium">
            The Platforms:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'do not custody assets',
              'do not control tokens after creation',
              'do not operate an exchange',
              'do not guarantee liquidity, value, or outcomes',
              'do not review or endorse user-generated content',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-ek-body">
            All actions occur{' '}
            <span className="font-semibold text-ek-text">
              at your own risk
            </span>
            .
          </p>
        </section>

        {/* Section 2 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            2. RISK OF TOTAL LOSS
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            Digital assets are highly speculative. You may lose{' '}
            <span className="font-semibold text-ek-text">some or all</span>{' '}
            of the value of tokens you create, acquire, or trade.
          </p>

          <p className="text-ek-body mb-4 font-medium">
            Losses may occur due to:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'price volatility',
              'lack of liquidity',
              'abandonment of a token or project',
              'market manipulation',
              'regulatory action',
              'technical failure',
              'smart contract exploits',
              'AI errors or malfunctions',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-ek-body">
            You should never use funds you cannot afford to lose.
          </p>
        </section>

        {/* Section 3 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            3. SMART CONTRACT RISK
          </h3>
          <p className="text-ek-body mb-4 font-medium">
            Smart contracts are experimental technology and may contain:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'bugs',
              'vulnerabilities',
              'logic errors',
              'undiscovered exploits',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-ek-body mb-4 font-medium">
            These issues may result in:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'permanent loss of funds',
              'inability to trade or transfer tokens',
              'unexpected token behavior',
              'unauthorized access to funds',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className="text-ek-muted">
            The Platforms do{' '}
            <span className="font-semibold text-ek-text">not</span> audit or
            guarantee the security of smart contracts you interact with,
            including those generated by AI tools.
          </p>
        </section>

        {/* Section 4 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            4. THIRD-PARTY PROTOCOL RISK
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            Trading and liquidity for Tokens occurs through{' '}
            <span className="font-semibold text-ek-text">
              third-party decentralized protocols
            </span>
            , including but not limited to Uniswap and Doppler.
          </p>

          <p className="text-ek-body mb-4 font-medium">
            The Platforms do{' '}
            <span className="font-semibold text-ek-text">not</span>:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'control these protocols',
              'control liquidity pools',
              'set prices or fees',
              'guarantee execution or uptime',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-muted">
            Failures, exploits, upgrades, forks, or shutdowns of these protocols
            may result in loss.
          </p>
        </section>

        {/* Section 5 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            5. IRREVERSIBLE TRANSACTIONS
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            Blockchain transactions are{' '}
            <span className="font-semibold text-ek-text">irreversible</span>{' '}
            once confirmed.
          </p>

          <p className="text-ek-body mb-4 font-medium">
            The Platforms cannot:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'reverse transactions',
              'recover lost funds',
              'correct user errors',
              'recover funds sent to wrong addresses',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Sending assets to the wrong address or interacting with the wrong
            contract may result in permanent loss.
          </p>
        </section>

        {/* Section 6 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            6. MARKET MANIPULATION & MEV
          </h3>
          <p className="text-ek-body mb-4 font-medium">
            Token markets may be subject to:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'front-running',
              'sandwich attacks',
              'MEV (Maximal Extractable Value) extraction',
              'wash trading',
              'pump-and-dump schemes',
              'price manipulation',
              'coordinated manipulation',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body leading-relaxed mb-4">
            These activities may cause significant losses and unfavorable
            execution prices.
          </p>
          <p className="text-ek-body">
            <span className="font-semibold text-ek-text">
              The Platforms do not provide MEV protection.
            </span>{' '}
            Transactions submitted through the Platforms may be visible in the
            mempool and subject to front-running.
          </p>
        </section>

        {/* Section 7 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            7. LIQUIDITY & PRICING RISK
          </h3>
          <p className="text-ek-body mb-4 font-medium">Tokens may:</p>
          <ul className="space-y-3 mb-6">
            {[
              'have little or no liquidity',
              'experience extreme price swings',
              'be impossible to sell at desired prices',
              'become worthless',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Liquidity may be removed or never added. The Platforms do not
            guarantee liquidity.
          </p>
        </section>

        {/* Section 8 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            8. TOKEN CREATOR RISK
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            Tokens created on the Platforms are{' '}
            <span className="font-semibold text-ek-text">
              user-generated
            </span>
            .
          </p>
          <p className="text-ek-body mb-4 font-medium">
            The Platforms do{' '}
            <span className="font-semibold text-ek-text">not</span>:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'vet creators',
              'verify claims',
              'guarantee legitimacy',
              'ensure ongoing development',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body mb-4 font-medium">
            Creators may:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'abandon projects',
              'change token economics',
              'make misleading statements',
              'engage in fraud',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            You are responsible for your own evaluation.
          </p>
        </section>

        {/* Section 9 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            9. REGULATORY & LEGAL RISK
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            Digital asset laws are uncertain and evolving.
          </p>
          <p className="text-ek-body mb-4 font-medium">
            Risks include:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'new regulations or bans',
              'reclassification of tokens as securities or financial instruments',
              'restrictions on usage, trading, or access',
              'enforcement actions against users or creators',
              'tax obligations and reporting requirements',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            The Platforms do not guarantee compliance with any jurisdiction&apos;s
            laws.{' '}
            <span className="font-semibold text-ek-text">
              You are solely responsible for determining whether your use of the
              Platforms is lawful.
            </span>
          </p>
        </section>

        {/* Section 10 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            10. NO INVESTMENT ADVICE
          </h3>
          <p className="text-ek-body mb-4 font-medium">
            The Platforms do{' '}
            <span className="font-semibold text-ek-text">not</span> provide:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'investment advice',
              'financial advice',
              'legal or tax advice',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Any information displayed is for{' '}
            <span className="font-semibold text-ek-text">
              informational purposes only
            </span>{' '}
            and should not be relied upon.
          </p>
        </section>

        {/* Section 11 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            11. TECHNOLOGY & NETWORK RISK
          </h3>
          <p className="text-ek-body mb-4 font-medium">
            Risks include:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'blockchain congestion',
              'network outages',
              'software bugs',
              'wallet incompatibility',
              'chain reorganizations',
              'hard forks',
              'infrastructure failures',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            These issues may delay or prevent transactions.
          </p>
        </section>

        {/* Section 12 - NEW */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            12. AI-GENERATED APPLICATION RISKS
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            If you use Minidev to generate applications:
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            12.1 Code Quality
          </h4>
          <p className="text-ek-body mb-4 font-medium">
            AI-generated code may:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'contain bugs or errors',
              'have security vulnerabilities',
              'not function as intended',
              'be incomplete or incorrect',
              'require manual review and testing',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body leading-relaxed mb-6">
            <span className="font-semibold text-ek-text">
              You are responsible for reviewing all AI-generated code before
              deployment.
            </span>
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            12.2 No Guarantee of Correctness
          </h4>
          <p className="text-ek-body mb-4 font-medium">
            AI tools may:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'misunderstand your requirements',
              'produce incorrect logic',
              'generate insecure code',
              'fail to handle edge cases',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body leading-relaxed mb-6">
            The Platforms do not guarantee that AI-generated code is correct,
            secure, or fit for any purpose.
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            12.3 Intellectual Property
          </h4>
          <p className="text-ek-body mb-4 font-medium">
            AI-generated code may:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'be similar to code generated for other users',
              'incorporate patterns from training data',
              'have uncertain copyright status',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            The Platforms make no warranties regarding intellectual property
            rights in AI-generated code.
          </p>
        </section>

        {/* Section 13 - NEW */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            13. AI AGENT RISKS
          </h3>
          <p className="text-ek-body leading-relaxed mb-6">
            If you deploy AI agents using the Agent Template:
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.1 Agent Behavior
          </h4>
          <p className="text-ek-body mb-4 font-medium">
            AI agents may:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'produce unexpected or undesired outputs',
              'make errors in judgment or execution',
              'fail to execute intended actions',
              'execute unintended actions',
              'generate content that is inaccurate, offensive, or harmful',
              'misinterpret instructions',
              'behave unpredictably',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.2 Agent Autonomy
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            Agents operate autonomously within configured parameters. You are
            responsible for:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'setting appropriate limits and safeguards',
              'monitoring agent activity regularly',
              'disabling agents that malfunction',
              'consequences of agent actions',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.3 Agent Transactions
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            Agents may execute blockchain transactions on your behalf,
            including:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'token trades',
              'token burns',
              'token transfers',
              'contract interactions',
              'social media posts',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body leading-relaxed mb-6">
            <span className="font-semibold text-ek-text">
              These transactions are irreversible. You bear full responsibility
              for all agent-initiated transactions.
            </span>
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.4 Agent-Generated Content
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            Content created by AI agents (including marketing, communications,
            social posts, or token metadata) is your responsibility. The
            Platforms do not review or endorse agent outputs.
          </p>
          <p className="text-ek-body mb-4 font-medium">
            Agents may generate content that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'violates platform policies',
              'infringes third-party rights',
              'is factually incorrect',
              'causes reputational harm',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.5 Third-Party API Risks
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            Agents rely on third-party APIs (e.g., Anthropic, OpenAI,
            X/Twitter). Risks include:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'API outages or rate limits',
              'changes to API terms or pricing',
              'API provider policy violations',
              'account suspension by API providers',
              'unexpected API behavior changes',
              'API deprecation',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            The Platforms are not responsible for third-party API failures or
            policy enforcement.
          </p>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.6 API Key Risks
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            You provide your own API keys for Agent Template. Risks include:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'unauthorized use if keys are compromised',
              'unexpected charges from API providers',
              'account termination by API providers',
              'rate limiting affecting agent function',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body mb-4 font-medium">
            You are responsible for:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'key security',
              'monitoring usage',
              'compliance with API provider terms',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h4 className="text-xl font-medium mb-4 text-ek-text font-funnel-display">
            13.7 Agent Wallet Risks
          </h4>
          <p className="text-ek-body leading-relaxed mb-4">
            If your agent has wallet access:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'agents may execute unauthorized transactions',
              'bugs may cause unintended fund transfers',
              'agents cannot be "un-done" once they act on-chain',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 14 - NEW */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            14. TOKEN BURN RISKS
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            Certain agent or platform mechanics may result in automatic token
            burns:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'accountability burns (failure to meet commitments)',
              'fee-based burns',
              'protocol-level burns',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Burns are{' '}
            <span className="font-semibold text-ek-text">
              irreversible and permanent
            </span>
            . Burned tokens cannot be recovered.
          </p>
        </section>

        {/* Section 15 - NEW */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            15. HOSTING & AVAILABILITY RISKS
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            The Platforms provide hosting for applications and agents.
          </p>
          <p className="text-ek-body mb-4 font-medium">
            Risks include:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'service outages',
              'data loss',
              'migration issues',
              'termination of service',
              'infrastructure failures',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            The Platforms do not guarantee uptime or data preservation.
          </p>
        </section>

        {/* Section 16 - NEW */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            16. CREDIT & PAYMENT RISKS
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            Credits purchased for the Platforms:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'are non-refundable',
              'may expire per Terms',
              'have no cash value',
              'cannot be transferred',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Payment transactions are subject to blockchain risks described
            above.
          </p>
        </section>

        {/* Section 17 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            17. NO GUARANTEES
          </h3>
          <p className="text-ek-body mb-4 font-medium">
            The Platforms make{' '}
            <span className="font-semibold text-ek-text">no guarantees</span>{' '}
            regarding:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'token value',
              'future utility',
              'liquidity',
              'performance',
              'success of any project',
              'AI output quality',
              'agent behavior',
              'application functionality',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            Past performance is not indicative of future results.
          </p>
        </section>

        {/* Section 18 */}
        <section className="mb-10">
          <h3 className="text-2xl font-medium mb-6 text-ek-text font-funnel-display">
            18. ASSUMPTION OF RISK
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            By using the Platforms, you expressly acknowledge and agree that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'you understand the risks described above',
              'you accept full responsibility for your actions',
              'you accept full responsibility for AI agents you deploy',
              'you accept full responsibility for applications you create',
              'the Platforms are not liable for losses you incur',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-ek-body"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ek-blue-bright mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-ek-body">
            If you do not understand or accept these risks,{' '}
            <span className="font-semibold text-ek-text">
              do not use the Platforms
            </span>
            .
          </p>
        </section>

        {/* Final Notice */}
        <section className="mt-10 mb-20">
          <h3 className="text-2xl md:text-3xl font-medium mb-6 text-ek-text font-funnel-display">
            FINAL NOTICE
          </h3>
          <p className="text-ek-body leading-relaxed mb-4">
            Digital assets and AI tools are{' '}
            <span className="font-semibold text-ek-text">high-risk</span> and{' '}
            <span className="font-semibold text-ek-text">experimental</span>.
          </p>
          <p className="text-ek-body leading-relaxed mb-4">
            Only experienced users who understand decentralized systems and AI
            limitations should use the Platforms.
          </p>
          <p className="text-ek-body">
            <span className="font-semibold text-ek-text">
              NEVER INVEST MORE THAN YOU CAN AFFORD TO LOSE.
            </span>
          </p>
        </section>

        {/* Company Info */}
        <section className="mb-10 pb-8 border-t border-ek-line italic pt-8">
          <p className="text-ek-body">TokenFi Inc. - Delaware, USA</p>
          <p className="text-ek-body">
            Contact:{' '}
            <a
              href="mailto:j@earnkit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ek-text"
            >
              j@earnkit.com
            </a>
          </p>
        </section>
      </div>
    </Panel>
  );
}
