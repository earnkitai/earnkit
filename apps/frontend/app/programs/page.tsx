import { permanentRedirect } from 'next/navigation';

/**
 * v3.1 W10: the programs list left the site; its money lives in the landing's "earn" section. An old
 * /programs link lands there (308). Each program's guide stays at /programs/<id> and in the sitemap.
 */
export default function ProgramsPage() {
  permanentRedirect('/#earn');
}
