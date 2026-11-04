import { permanentRedirect } from 'next/navigation';

/** Old links point here; the install steps live on /docs. */
export default function Install() {
  permanentRedirect('/docs#install');
}
