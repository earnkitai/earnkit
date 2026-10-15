import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { builderScoreEnabled } from '../../lib/earnkit/builder-score-flag';
import { HandleView, handleMetadata, tabOf } from './handle-view';

/** Read live on every request: a hide or a rename shows at once. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ handle: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if (!builderScoreEnabled()) return {};
  return handleMetadata((await params).handle);
}

/** v2.12.1 spec "Identity": earnkit.com/<x-handle>, once claimed with X. Flag off: 404. */
export default async function HandlePage({ params, searchParams }: Params) {
  if (!builderScoreEnabled()) notFound();
  const { handle } = await params;
  return HandleView({ handle, path: `/${handle}`, tab: tabOf(await searchParams) });
}
