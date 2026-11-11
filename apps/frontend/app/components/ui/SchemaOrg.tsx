import { ONE_LINE } from '../../../lib/v5/site-copy';

export default function SchemaOrg() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'EarnKit',
    url: 'https://earnkit.com',
    logo: 'https://earnkit.com/logo.png',
    slogan: 'Get funded for what you ship.',
    description: `${ONE_LINE} Agents connect at https://earnkit.com/mcp.`,
    sameAs: ['https://x.com/EarnKitAI'],
    parentOrganization: {
      '@type': 'Organization',
      name: 'Tokenfi Inc.',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'j@earnkit.com',
      contactType: 'customer service',
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
