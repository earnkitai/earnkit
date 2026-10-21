import type { Metadata } from 'next';
import { HandleView, handleMetadata, pageOf } from './handle-view';

/** Read live on every request: a hide or a rename shows at once. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ handle: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return handleMetadata((await params).handle);
}

/** v2.12.1 spec "Identity": earnkit.com/<x-handle>, once claimed with X. */
export default async function HandlePage({ params, searchParams }: Params) {
  const { handle } = await params;
  return HandleView({ handle, path: `/${handle}`, page: pageOf(await searchParams) });
}
