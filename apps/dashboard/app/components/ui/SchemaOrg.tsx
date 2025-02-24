export default function SchemaOrg() {
    const schema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "EarnKit",
        url: "https://app.earnkit.com",
        logo: "https://app.earnkit.com/logo.png",
        description: "Build and deploy custom AI agents effortlessly with EarnKit. Our platform enables quick creation of specialized AI solutions for various business needs.",
        sameAs: [
            "https://x.com/EarnKit_ai",
            "https://warpcast.com/earnkit"
        ],
        contactPoint: {
            "@type": "ContactPoint",
            email: "contact@earnkit.com",
            contactType: "customer service"
        }
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
    );
} 