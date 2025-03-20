"use client"

import { TurnkeyProvider } from "@turnkey/sdk-react"
import { EthereumWallet } from "@turnkey/wallet-stamper"

import { turnkeyConfig } from "@/config/turnkey"

import { AuthProvider } from "@/providers/auth-provider"
import { ThemeProvider } from "@/providers/theme-provider"
import { WagmiProviderWrapper } from "@/providers/wagmi-provider"

const wallet = new EthereumWallet()

export const Providers: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => (
    <ThemeProvider
        attribute="class"
        defaultTheme="light"
        forcedTheme="light"
        enableSystem={false}
        disableTransitionOnChange
    >
        <WagmiProviderWrapper>
            <TurnkeyProvider
                config={{
                    rpId: turnkeyConfig.passkey.rpId,
                    apiBaseUrl: turnkeyConfig.apiBaseUrl,
                    defaultOrganizationId: turnkeyConfig.organizationId,
                    iframeUrl: turnkeyConfig.iFrame.url,
                    wallet: wallet,
                }}
            >
                <AuthProvider> {children}</AuthProvider>
            </TurnkeyProvider>
        </WagmiProviderWrapper>
    </ThemeProvider>
)
