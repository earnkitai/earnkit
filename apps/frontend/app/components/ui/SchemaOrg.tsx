export default function SchemaOrg() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'EarnKit',
    url: 'https://earnkit.com',
    logo: 'https://earnkit.com/logo.png',
    slogan: 'Ship every week. Get funded.',
    description:
      'EarnKit ranks builders by what they ship and finds grants that fit. Agents connect at https://earnkit.com/mcp.',
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
