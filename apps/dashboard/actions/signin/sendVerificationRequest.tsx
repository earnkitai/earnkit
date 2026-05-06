import { createTransport } from "nodemailer"
interface SendVerificationRequestParams {
    identifier: string,
    url: string,
    provider: { server: string, from: string },
    theme: Theme
}

interface Theme {
    brandColor: string,
    buttonText: string
}

export async function handleEmailSignIn(params: SendVerificationRequestParams) {
    const { identifier, url, provider, theme } = params
    const { host } = new URL(url)
    // NOTE: You are not required to use `nodemailer`, use whatever you want.
    const transport = createTransport(provider.server)
    const result = await transport.sendMail({
        to: identifier,
        from: provider.from,
        subject: `Sign in to ${host}`,
        text: text({ url, host }),
        html: html({ url, host, theme }),
    })
    const failed = result.rejected.concat(result.pending).filter(Boolean)
    if (failed.length) {
        throw new Error(`Email(s) (${failed.join(", ")}) could not be sent`)
    }
}

function html(params: { url: string; host: string; theme: Theme }) {
    const { url, host, theme } = params

    const escapedHost = host.replace(/\./g, "&#8203;.")

    const brandColor = theme.brandColor || "#007AFF"


    return `
<body style="font-family: 'Source Sans Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
            <td align="center" style="padding: 24px;">
                <table class="content" cellpadding="0" cellspacing="0" role="presentation">
                    <!-- Logo Header -->
                    <tr>
                        <td class="header">
                           <div style="background-color: ${brandColor}; display: flex; justify-content: center; margin-bottom: 16px; padding: 20px;">
                    <svg width="136.5" height="80" viewBox="0 0 138 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fillRule="evenodd" clipRule="evenodd" d="M60.711 16.3597C60.711 11.8335 64.3802 8.16426 68.9064 8.16426C73.4326 8.16426 77.1018 11.8335 77.1018 16.3597H85.266C85.266 7.32447 77.9416 0 68.9064 0C59.8712 0 52.5467 7.32447 52.5467 16.3597H60.711ZM52.4866 24.608C57.042 24.608 60.7349 20.9151 60.7349 16.3597H68.8992C68.8992 25.4241 61.551 32.7723 52.4866 32.7723V24.608ZM77.0779 16.3597C77.0779 20.8766 80.7396 24.5383 85.2565 24.5383V32.7025C76.2306 32.7025 68.9136 25.3856 68.9136 16.3597H77.0779ZM118.389 54.2984C120.252 54.2984 121.762 52.7885 121.762 50.926C121.762 49.0634 120.252 47.5536 118.389 47.5536C116.527 47.5536 115.017 49.0634 115.017 50.926C115.017 52.7885 116.527 54.2984 118.389 54.2984ZM115.017 56.2789V79.7117H121.762V56.2789H115.017ZM131.07 63.4862V68.0609C131.085 70.9894 133.348 73.2421 137.258 73.2552L137.236 80C130.609 79.9778 124.356 75.6384 124.325 68.0826L124.325 68.0687V50.5921H131.07V56.7413H137.246V63.4862H131.07ZM40.8535 79.7117V78.6078C39.3721 79.293 37.7219 79.6754 35.9824 79.6754C29.5671 79.6754 24.3664 74.4747 24.3664 68.0594C24.3664 61.6441 29.5671 56.4434 35.9824 56.4434C37.7219 56.4434 39.3721 56.8258 40.8535 57.511V56.2789H47.5984V68.0416L47.5984 68.0594L47.5984 68.0772V79.7117H40.8535ZM40.8535 68.0709V68.0479C40.8473 65.3629 38.6688 63.1883 35.9824 63.1883C33.2921 63.1883 31.1113 65.3691 31.1113 68.0594C31.1113 70.7496 33.2921 72.9305 35.9824 72.9305C38.6688 72.9305 40.8473 70.7559 40.8535 68.0709ZM70.9101 68.0594C70.9101 65.3692 73.091 63.1883 75.7812 63.1883C78.4715 63.1883 80.6524 65.3692 80.6524 68.0594V79.6643H87.3972V68.0594C87.3972 61.6441 82.1966 56.4435 75.7812 56.4435C69.3659 56.4435 64.1653 61.6441 64.1653 68.0594V79.6643H70.9101V68.0594ZM61.5307 63.2045L62.9188 63.1881L62.8391 56.4437L61.4693 56.4599C55.0901 56.4715 49.8418 61.625 49.8418 68.0594V79.6574H56.5866V68.0594C56.5866 65.3955 58.7742 63.2047 61.4909 63.2047H61.5108L61.5307 63.2045ZM16.2459 48.2961L16.1824 48.2963H16.0361V48.2975C7.43355 48.4098 0.494507 55.4183 0.494507 64.0475C0.494507 72.6767 7.43356 79.6852 16.0361 79.7975V79.7989H16.2282L16.2459 79.7989L22.8061 79.7989L22.8061 73.054L16.2313 73.054C12.4559 73.048 9.22519 70.7191 7.89204 67.42H19.5374L19.5374 60.6752L7.89195 60.6752C9.22111 57.3858 12.4367 55.0607 16.1979 55.0411L22.8061 55.0411L22.8061 48.2963L16.2459 48.2963V48.2961ZM89.4709 79.5832V50.1189H96.2157V79.5832H89.4709ZM98.8409 62.916C103.176 59.7548 105.129 54.579 105.159 50.2283L111.904 50.2748C111.868 55.5061 109.877 61.7175 105.229 66.3125L113.6 79.6689H105.64L97.9704 67.4317L96.3012 64.7682L98.8409 62.916Z" fill="#ffffff" fillOpacity="0.4" />
                    </svg>
                </div>
                        </td>
                    </tr>
                    <!-- Main Content -->
                    <tr>
                        <td class="main">
                            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                                <tr>
                                    <td class="wrapper">
                                        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                                            <tr>
                                                <td align="center">
                                                    <h1 style="padding: 0px 20px; font-size: 24px; line-height: 32px; font-weight: 700; color: #1f2937;">
                                                        Verify your email address
                                                    </h1>
                                                    <p style="padding: 0px 20px; font-size: 16px; line-height: 24px; color: #6b7280;">
                                                        Click the button below to verify your email address and sign in to ${escapedHost}.
                                                    </p>
                                                    <!-- Verification Button -->
                                                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin: 30px 50px;">
                                                        <tr>
                                                            <td align="center" style="border-radius: 8px; background-color: ${brandColor};">
                                                                <a href="${url}"
                                                                   style="display: inline-block;  padding: 16px 32px; font-size: 16px; font-weight: 600; line-height: 1; color: #ffffff; text-decoration: none; border-radius: 8px;"
                                                                   target="_blank">
                                                                    Verify Email
                                                                </a>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                    <!-- Expiration Notice -->
                                                    <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                                                        This verification link will expire in 24 hours.
                                                    </p>
                                                    <!-- Security Notice -->
                                                    <table width="100%" style="margin-top: 24px; border-top: 1px solid #e5e7eb;">
                                                        <tr>
                                                            <td style="padding-top: 24px;">
                                                                <p style="margin: 0; font-size: 14px; line-height: 20px; color: #9ca3af; text-align: center;">
                                                                    If you didn't request this email, you can safely ignore it.
                                                                </p>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td class="footer">
                            <p style="margin: 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                                © ${new Date().getFullYear()} EarnKit. All rights reserved.
                            </p>
                            <p style="margin: 8px 0 0; font-size: 14px; line-height: 20px; color: #6b7280;">
                                Made with ♥ by EarnKit Team
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
`
}

// Also update the text version for better plain-text emails
function text({ url, host }: { url: string; host: string }) {
    return `
Verify your email address for ${host}

Click the following link to verify your email address and sign in:
${url}

This verification link will expire in 24 hours.

If you didn't request this email, you can safely ignore it.

© ${new Date().getFullYear()} EarnKit. All rights reserved.
`
}
