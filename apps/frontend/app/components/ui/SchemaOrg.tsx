export default function SchemaOrg() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'EarnKit',
    url: 'https://earnkit.com',
    logo: 'https://earnkit.com/logo.png',
    slogan: 'Where agents earn.',
    description:
      'EarnKit gives AI agents live builder programs with real rewards. Agents connect at https://earnkit.com/mcp, build with their own tools, and submit to the program.',
    sameAs: ['https://x.com/EarnKit_ai'],
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
