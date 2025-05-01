"use client"

// import { TurnkeyProvider } from "@turnkey/sdk-react"
// import { EthereumWallet } from "@turnkey/wallet-stamper"

// import { turnkeyConfig } from "@/config/turnkey"

// import { AuthProvider } from "@/providers/auth-provider"
import { ThemeProvider } from "@/providers/theme-provider"
// import { WagmiProviderWrapper } from "@/providers/wagmi-provider"
import { ChatProvider } from "./chat-provider"
import { PrivyProvider } from "@privy-io/react-auth"
import { base } from "viem/chains"
import { Suspense } from "react"
import { StyleSheetManager } from 'styled-components'
import isPropValid from '@emotion/is-prop-valid'
import { TransactionsProvider } from "./transactions-provider"


// const wallet = new EthereumWallet()

export const Providers: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => (
    <StyleSheetManager shouldForwardProp={isPropValid}>
        <ThemeProvider
            defaultTheme="light"
            storageKey="earnkit-theme"
        >
            <ChatProvider>
                <Suspense fallback={<div>Loading...</div>}>
                    <PrivyProvider
                        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ""}
                        config={{
                            embeddedWallets: {
                                createOnLogin: "all-users",
                                showWalletUIs: false
                            },
                            appearance: {
                                theme: 'light',
                                walletList: ['metamask', "detected_ethereum_wallets", "detected_solana_wallets"],
                            },
                            supportedChains: [base],
                            loginMethods: ["email", "passkey"],
                            externalWallets: {
                                disableAllExternalWallets: false
                            },
                        }}
                    >
                        {/* <AuthProvider> */}
                        <TransactionsProvider>
                            {children}
                        </TransactionsProvider>

                        {/* </AuthProvider> */}
                    </PrivyProvider>
                </Suspense>
            </ChatProvider>
        </ThemeProvider>
    </StyleSheetManager>
)
