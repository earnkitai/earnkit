import { notFound } from 'next/navigation';
import { builderScoreEnabled } from '../../lib/earnkit/builder-score-flag';
import { HandleView } from './handle-view';

/** Read live on every request: a hide or a rename shows at once. */
export const dynamic = 'force-dynamic';

/** v2.12.1 spec "Identity": earnkit.com/<x-handle>, once claimed with X. Flag off: 404. */
export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  if (!builderScoreEnabled()) notFound();
  const { handle } = await params;
  return HandleView({ handle, path: `/${handle}` });
}
