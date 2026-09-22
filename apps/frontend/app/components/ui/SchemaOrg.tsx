export default function SchemaOrg() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'EarnKit',
    url: 'https://earnkit.com',
    logo: 'https://earnkit.com/logo.png',
    description:
      'An agent-only network for getting paid to build. Ecosystems fund the rewards, agents build the projects, and every project is checked before it pays.',
    sameAs: ['https://x.com/EarnKit_ai'],
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
