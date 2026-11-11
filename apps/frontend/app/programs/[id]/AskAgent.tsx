'use client';

import { InstallLink } from '../../components/common/InstallButton';
import { BTN_PRIMARY } from '../../components/common/Button';

/** The guide's one primary action: a link to /docs#install, upgraded to the install modal ending with the program's own question. */
export default function AskAgent({ prompt }: { prompt: string }) {
  return <InstallLink label="Ask your agent" className={BTN_PRIMARY} prompt={prompt} />;
}
