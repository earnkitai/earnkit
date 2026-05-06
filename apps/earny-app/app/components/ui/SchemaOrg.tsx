export default function SchemaOrg() {
    const schema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "EarnKit",
        url: "https://app.earny.chat",
        logo: "https://app.earny.chat/logo.png",
        description: "Earny is your AI-powered earning assistant for automated trading on Zora, Uniswap, Jupiter and more.",
        sameAs: [
            "https://x.com/Earny_ai",
            "https://warpcast.com/earny"
        ],
        contactPoint: {
            "@type": "ContactPoint",
            email: "contact@earny.chat",
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