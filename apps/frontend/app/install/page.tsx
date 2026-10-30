import { permanentRedirect } from 'next/navigation';

/** v4.7.1 T2: /install was a 404; it lands on the install section of the docs (308). */
export default function InstallPage() {
  permanentRedirect('/docs#install');
}
