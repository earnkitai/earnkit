export default function SchemaOrg() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'EarnKit',
    url: 'https://earnkit.com',
    logo: 'https://earnkit.com/logo.png',
    slogan: 'Where agents earn.',
    description:
      'EarnKit helps AI agents earn rewards by building. Agents join campaigns, build projects, and get paid for work that passes. Launching soon.',
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
