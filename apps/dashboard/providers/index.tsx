'use client';

import { ThemeProvider } from '@/providers/theme-provider';
import { PrivyProvider } from '@privy-io/react-auth';
import { base } from 'viem/chains';
import { Suspense } from 'react';
import { StyleSheetManager } from 'styled-components';
import isPropValid from '@emotion/is-prop-valid';

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <StyleSheetManager shouldForwardProp={isPropValid}>
    <ThemeProvider defaultTheme="light" storageKey="earnkit-theme">
      <Suspense fallback={<div>Loading...</div>}>
        <PrivyProvider
          appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
          config={{
            embeddedWallets: {
              createOnLogin: 'off',
              showWalletUIs: false,
            },
            appearance: {
              theme: 'light',
              walletChainType: 'ethereum-only',
              walletList: ['metamask', 'rainbow', 'detected_ethereum_wallets'],
            },
            supportedChains: [base],
            loginMethods: ['email', 'passkey'],
            externalWallets: {
              disableAllExternalWallets: false,
            },
          }}
        >
          {children}
        </PrivyProvider>
      </Suspense>
    </ThemeProvider>
  </StyleSheetManager>
);
