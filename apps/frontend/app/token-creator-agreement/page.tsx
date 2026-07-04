import Header from '../components/common/Header';
import Footer from '../components/common/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Token Creator Agreement | Earnkit',
};

export default function TokenCreatorAgreementPage() {
  return (
    <div className="min-h-screen bg-white text-foreground">
      <main className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 font-funnel-display">
            TOKEN CREATOR AGREEMENT
          </h1>
          <p className="text-subtle-foreground text-md">
            Last updated: January 29, 2026
          </p>
        </div>

        {/* Intro */}
        <div className="mb-12 pb-8 border-b border-border">
          <p className="text-muted-foreground leading-relaxed mb-4">
            This Token Creator Agreement ("Agreement") is entered into by and
            between:
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <span className="font-semibold text-foreground">TokenFi Inc.</span>,
            a Delaware corporation, together with its products tokens.fun and
            Minidev (collectively, "TokenFi," "we," "us"), and
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <span className="font-semibold text-foreground">You</span>, the
            individual or entity creating, deploying, or publishing a token
            using the tokens.fun platform ("Creator," "you").
          </p>
          <p className="text-muted-foreground leading-relaxed mb-6">
            This Agreement supplements and forms part of the TokenFi Inc. Terms
            & Conditions ("Master Terms"). In the event of any conflict, this
            Agreement shall prevail with respect to token creation and creator
            obligations.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">
              By creating, deploying, or publishing a token using tokens.fun,
              you agree to be bound by this Agreement.
            </span>
          </p>
        </div>

        {/* Section 1 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">1. SCOPE</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            This Agreement applies to any ERC-20 token or similar digital asset
            created, configured, deployed, or published by you (or by an AI
            agent deployed by you) using:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'tokens.fun',
              'the Doppler SDK',
              'Minidev',
              'any integrated smart contracts, interfaces, or tooling',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Each such token is referred to as a "Token".
          </p>
        </section>

        {/* Section 2 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            2. ROLE OF TOKENFI (NO ISSUER / NO CONTROL)
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You expressly acknowledge and agree that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'TokenFi is not the issuer, promoter, or sponsor of your Token',
              'TokenFi does not control token supply, pricing, liquidity, or distribution',
              'TokenFi does not market or endorse your Token',
              'TokenFi provides non-custodial software tools only',
              'All decisions, representations, and consequences relating to your Token are solely your responsibility',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span
                  dangerouslySetInnerHTML={{
                    __html: item
                      .replace(
                        /not/g,
                        '<span class="font-semibold text-foreground">not</span>',
                      )
                      .replace(
                        /solely your responsibility/g,
                        '<span class="font-semibold text-foreground">solely your responsibility</span>',
                      ),
                  }}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Section 3 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            3. CREATOR REPRESENTATIONS & WARRANTIES
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6">
            You represent, warrant, and covenant that:
          </p>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            3.1 Authority
          </h3>
          <ul className="space-y-3 mb-6">
            {[
              'You have full legal authority to create and deploy the Token',
              'You are not acting on behalf of an undisclosed third party',
              'You are at least 18 years old',
              'You are not located in a sanctioned jurisdiction',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            3.2 Intellectual Property
          </h3>
          <ul className="space-y-3 mb-6">
            {[
              'You own or have valid rights to all names, branding, logos, metadata, and content associated with the Token',
              'The Token does not infringe any intellectual property, publicity, or privacy rights',
              'You are not impersonating any person, company, or project',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            3.3 No Misrepresentation
          </h3>
          <p className="text-muted-foreground mb-4 font-medium">
            You will not:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'represent the Token as an investment, security, or profit-generating instrument',
              'promise profits, returns, or price appreciation',
              'imply endorsement or approval by TokenFi, Minidev, or Doppler',
              'make false or misleading statements about the Token',
              'engage in pump-and-dump or market manipulation schemes',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            3.4 Legal & Regulatory Compliance
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You are{' '}
            <span className="font-semibold text-foreground">
              solely responsible
            </span>{' '}
            for compliance with:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'securities laws',
              'commodities laws',
              'consumer protection laws',
              'advertising and disclosure laws',
              'tax obligations',
              'anti-money laundering laws',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            in all applicable jurisdictions.
          </p>
        </section>

        {/* Section 4 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            4. AI AGENT-CREATED TOKENS
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6">
            Where a Token is created by or associated with an AI agent deployed
            through Minidev:
          </p>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            4.1 Creator Responsibility
          </h3>
          <ul className="space-y-3 mb-6">
            {[
              'The human user who deployed the agent is the "Creator" for purposes of this Agreement',
              'You are responsible for all agent actions, including token creation, trading, and burning',
              'Agent-generated content, marketing, or representations are deemed your conduct',
              'You cannot disclaim responsibility by blaming agent behavior',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            4.2 Agent Monitoring
          </h3>
          <p className="text-muted-foreground mb-4 font-medium">
            You are responsible for:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'configuring agent parameters appropriately',
              'monitoring agent token-related activities',
              'disabling agents that violate this Agreement',
              'consequences of all agent actions',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            4.3 TokenFi's Role
          </h3>
          <p className="text-muted-foreground mb-4 font-medium">TokenFi:</p>
          <ul className="space-y-3 mb-6">
            {[
              'does not control AI agents',
              'is not responsible for agent behavior',
              'may suspend agents that violate Terms',
              'has no liability for agent-initiated token activities',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 5 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            5. NO SECURITIES OR FINANCIAL PROMISES
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You acknowledge and agree that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'TokenFi makes no determination as to whether your Token is a security',
              'Token classification depends on your conduct, marketing, and usage',
              'You assume all regulatory and legal risk arising from the Token',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mb-4 font-medium">
            TokenFi expressly disclaims any responsibility for:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'securities compliance',
              'whitepapers or disclosures',
              'regulatory filings or approvals',
              'financial advice or guidance',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 6 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            6. TRADING, FEES & REVENUE SPLITS
          </h2>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            6.1 Third-Party Trading
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You acknowledge that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'Token trading occurs via third-party decentralized protocols, including Uniswap (v4 pools)',
              'TokenFi does not control liquidity, pricing, execution, or market behavior',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            6.2 Protocol-Level Fees
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Certain trades may generate protocol-enforced fees (e.g., 1% Uniswap
            v4 pool fee).
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You acknowledge and agree that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'fee logic is implemented at the protocol level',
              'fees may be automatically split between Doppler, Minidev, and you (as Creator)',
              'fee percentages are set at token creation',
              'TokenFi does not guarantee fee amounts, frequency, or continuity',
              'protocol upgrades or governance decisions may alter fee mechanics without notice',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-semibold mb-4 text-foreground">
            6.3 Token Burns
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Certain platform or agent mechanics may result in automatic token
            burns:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'accountability burns (e.g., agent missing commitments)',
              'fee-based burns',
              'protocol-level burns',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mb-4 font-medium">
            You acknowledge that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'burns are irreversible',
              'burned tokens cannot be recovered',
              'TokenFi does not control burn mechanics once deployed',
              'you accept burns as part of platform functionality',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 7 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            7. IRREVERSIBILITY & PUBLICATION
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You acknowledge that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'Token creation and deployment may be irreversible',
              'Blockchain transactions cannot be undone',
              'Tokens may remain tradable even if you abandon the project',
              'TokenFi bears no responsibility for post-deployment outcomes',
              'You cannot "undo" a token launch',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 8 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            8. DISCLAIMER OF RESPONSIBILITY
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            To the maximum extent permitted by law:
          </p>
          <ul className="space-y-3 mb-4">
            {[
              'TokenFi does not verify creator identity, claims, or legitimacy',
              'TokenFi does not audit or validate Tokens',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mb-4 font-medium">
            TokenFi is not responsible for:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'creator misconduct',
              'abandoned projects',
              'token price collapse',
              'losses suffered by token holders',
              'third-party protocol failures',
              'AI agent behavior',
              'market manipulation by others',
              'regulatory enforcement',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 9 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            9. INDEMNIFICATION (CRITICAL)
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You agree to indemnify, defend, and hold harmless:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'TokenFi Inc.',
              'tokens.fun',
              'Minidev',
              'Doppler',
              'all affiliates, officers, directors, employees, contractors, and agents',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-4">
            from and against any and all claims, damages, losses, liabilities,
            costs, and expenses (including reasonable attorneys' fees) arising
            out of or relating to:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'the Token you create',
              'statements, promises, or representations you make',
              'marketing or promotion of the Token',
              'regulatory or enforcement actions',
              'intellectual property claims',
              'losses suffered by token holders or third parties',
              'AI agent actions related to your Token',
              'any violation of this Agreement',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">
              This indemnification survives termination of this Agreement.
            </span>
          </p>
        </section>

        {/* Section 10 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            10. PLATFORM ENFORCEMENT
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            TokenFi reserves the right, in its sole discretion, to:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'restrict access to the interface',
              'hide or delist Tokens from the UI',
              'block Creator accounts',
              'suspend AI agents associated with Tokens',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mb-4 font-medium">
            where necessary to:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'comply with law',
              'mitigate legal or reputational risk',
              'respond to credible complaints',
              'enforce these Terms',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">
              Because the platform is non-custodial, TokenFi cannot seize Tokens
              or funds.
            </span>
          </p>
        </section>

        {/* Section 11 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            11. PROHIBITED TOKEN ACTIVITIES
          </h2>
          <p className="text-muted-foreground mb-4 font-medium">
            You may not create Tokens that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'impersonate existing projects, companies, or individuals',
              'use trademarked names or logos without authorization',
              'are designed primarily for fraud or manipulation',
              'facilitate money laundering or sanctions evasion',
              'promote illegal activities',
              'contain offensive or harmful metadata',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            TokenFi may remove such Tokens from the interface without notice.
          </p>
        </section>

        {/* Section 12 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            12. GOVERNING LAW & ARBITRATION
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6">
            This Agreement is governed by the laws of India for arbitration
            matters, and Delaware, USA for other matters.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Any dispute arising out of or relating to this Agreement shall be
            resolved exclusively by final and binding arbitration:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'Institution: Gujarat Chamber of Commerce & Industries (GCCI)',
              'Seat / Legal Place: Ahmedabad, India',
              'Language: English',
              'Arbitrator: Sole arbitrator appointed under GCCI bye-laws',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground leading-relaxed mb-4">
            For users in jurisdictions where this arbitration clause is
            unenforceable, disputes shall be resolved in the courts of Delaware,
            USA.
          </p>
          <p className="text-muted-foreground">
            This clause survives termination.
          </p>
        </section>

        {/* Section 13 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            13. SURVIVAL
          </h2>
          <p className="text-muted-foreground mb-4 font-medium">
            The following sections survive termination:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'Representations & Warranties',
              'Indemnification',
              'Disclaimers',
              'Governing Law & Arbitration',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 14 */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-6 text-position">
            14. ACKNOWLEDGEMENT & ACCEPTANCE
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            By creating or publishing a Token, you acknowledge and agree that:
          </p>
          <ul className="space-y-3 mb-6">
            {[
              'you are solely responsible for the Token',
              'TokenFi acts only as neutral software infrastructure',
              'you assume all legal, financial, and regulatory risk',
              'you have read and understood the Risk Disclosure',
              'you accept responsibility for AI agent actions related to your Token',
            ].map((item, index) => (
              <li
                key={index}
                className="flex items-start text-muted-foreground"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mt-2 mr-3 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">
              IF YOU DO NOT AGREE, DO NOT CREATE A TOKEN.
            </span>
          </p>
        </section>

        {/* Company Info */}
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
