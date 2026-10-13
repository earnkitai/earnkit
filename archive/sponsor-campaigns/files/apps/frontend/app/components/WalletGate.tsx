'use client';

import type { ReactNode } from 'react';
import { shortWallet, useAccount } from './wallet';

/**
 * Shows `children` (the page's action) only while the browser wallet is connected as the
 * campaign's bound wallet; otherwise asks for that wallet and offers no action.
 */
export default function WalletGate({
  wallet,
  children,
}: {
  wallet: string;
  children: ReactNode;
}) {
  const { account, connect, error } = useAccount();
  if (account === wallet.toLowerCase()) return <>{children}</>;
  return (
    <div className="mt-8 font-funnel-sans">
      <p className="text-base text-ek-white" role="status">
        Connect {shortWallet(wallet)} to continue.
      </p>
      {account ? (
        <p className="mt-2 text-sm text-ek-blue-light">
          Your wallet is connected as {shortWallet(account)}. Switch to the
          campaign&apos;s wallet in your wallet app.
        </p>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="mt-4 rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep"
        >
          Connect wallet
        </button>
      )}
      {error ? (
        <p className="mt-4 text-sm text-ek-blue-light" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
