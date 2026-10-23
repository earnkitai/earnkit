import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { clientIp } from '../../../lib/earnkit/rate-limit';
import { walletPageState } from '../../../lib/earnkit/wallet-proof';
import WalletView from './WalletView';

/**
 * v3.1 wallet proof: the signing page, in the v3.1 site design (the layout's nav, a neutral card on the dark page,
 * Kaftan title, the minimal footer). The link's state (wallet-proof.ts walletPageState) and the signing script
 * (WalletSign, EIP-1193 personal_sign) do the rest. Never indexed; the link is never sent on as a referrer.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Prove your Base wallet | EarnKit', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await searchParams;
  const state = await walletPageState(typeof t === 'string' ? t : '', new Date(), { ip: clientIp(await headers()) });
  return <WalletView state={state} />;
}
