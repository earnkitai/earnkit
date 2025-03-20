"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { ReactNode } from 'react';

const config = createConfig({
    chains: [base],
    connectors: [injected()],
    transports: {
        [base.id]: http(),
    },
    ssr: false,
});

const queryClient = new QueryClient();

export function WagmiProviderWrapper({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
} 