'use client';

import { Unavailable } from '../../components/site/Unavailable';
import { GUIDE_UNAVAILABLE } from './unavailable';

/**
 * A guide whose read failed (N3, v6.1.17 Task 4): the page throws, so ISR never caches the failure and keeps serving the
 * last good guide; with none kept yet, this panel shows (inside the site header, with JavaScript) and the next request
 * reads again. v6.1.17 final round: the one shared panel, footer included.
 */
export default function GuideError() {
  return <Unavailable text={GUIDE_UNAVAILABLE} />;
}
