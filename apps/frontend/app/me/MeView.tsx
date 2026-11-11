import { CARD_NAVY, CARD_PANEL, CARD_RUST, H1_SITE, PAGE_COL, PILL_WHITE } from '../components/site/ui';
import {
  ME_AGENTS_EMPTY, ME_AGENTS_TITLE, ME_APPROVE, ME_APPROVED, ME_BY_AGENT, ME_CHOICES, ME_DELETE, ME_DELETE_HINT,
  ME_DELETE_LINE, ME_DELETE_TITLE, ME_HINTS, ME_LABELS, ME_LEDGER_EMPTY, ME_LEDGER_TITLE, ME_LINK_NO, ME_LINK_YES, ME_LINKED, ME_NO, ME_NO_PROJECTS, ME_NOT_SET,
  ME_PENDING_LINE, ME_PENDING_TITLE, ME_POLICY_LINE, ME_SAVE, ME_SAVED, ME_SHORT_LABEL, ME_SIGN_OUT, ME_SIGNED_IN, ME_TEAM, ME_TITLE, ME_UNAPPROVE, ME_UNLINK, ME_YES,
} from '../../lib/v5/site-copy';
import { approvalPathOf, type MeData, type MeField } from '../../lib/v6/me-view';

/** /me: plain HTML forms only (no client script); every form carries the day's csrf token. */
const TITLE = 'ek-serif text-[32px] leading-none';
const INPUT = 'min-h-11 w-full rounded-[16px] border border-s-line bg-s-panel-inner px-4 py-2.5 text-[15px] text-s-text';
const SAVE = PILL_WHITE.replace('px-6', 'px-5');
const GHOST = 'inline-flex min-h-11 items-center justify-center rounded-full border border-s-line-hover px-5 text-[15px] text-s-text hover:bg-s-panel-hover';
const META = 'text-[13px] text-s-muted';

/** `Saved.` beside the control that saved (L21-11, v6.1.16). */
function Saved({ on }: { on: boolean }) {
  return on ? (
    <span role="status" className="self-center text-[15px] text-s-good-text">
      {ME_SAVED}
    </span>
  ) : null;
}

function Csrf({ token }: { token: string }) {
  return <input type="hidden" name="csrf" value={token} />;
}

/** The approval control beside an approvable field: the date and Unapprove, or Approve. */
function Approval({ path, approvedOn, seen, csrf }: { path: string; approvedOn: string | null; seen: string; csrf: string }) {
  return (
    <form method="post" action="/me/approve" className="flex flex-wrap items-center gap-3">
      <Csrf token={csrf} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="action" value={approvedOn ? 'unapprove' : 'approve'} />
      {!approvedOn && <input type="hidden" name="seen" value={seen} />}
      {approvedOn && <span className="text-[15px] text-s-good-text">{ME_APPROVED(approvedOn)}</span>}
      <button type="submit" className={approvedOn ? GHOST : SAVE}>
        {approvedOn ? ME_UNAPPROVE : ME_APPROVE}
      </button>
    </form>
  );
}

function Input({ f, id }: { f: MeField; id: string }) {
  if (f.kind === 'bool' || f.kind === 'choice') {
    const options: [string, string][] = f.kind === 'bool' ? [['true', ME_YES], ['false', ME_NO]] : (f.options ?? []).map((o) => [o, ME_CHOICES[o] ?? o]);
    return (
      <select id={id} name="value" defaultValue={f.value} className={INPUT}>
        <option value="">{ME_NOT_SET}</option>
        {options.map(([v, words]) => (
          <option key={v} value={v}>
            {words}
          </option>
        ))}
      </select>
    );
  }
  if (f.kind === 'long') return <textarea id={id} name="value" defaultValue={f.value} rows={4} className={`${INPUT} leading-[1.5]`} />;
  return <input id={id} name="value" type={f.kind === 'url' ? 'url' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} defaultValue={f.value} className={INPUT} />;
}

const hintOf = (path: string) => {
  if (/^team\.\d+\.name$/.test(path)) return ME_TEAM.hint;
  const key = path.startsWith('projects.') ? `project.${path.split('.').slice(2).join('.')}` : path;
  return (ME_HINTS as Record<string, string>)[key];
};

/** An answer's short form under it (v6.1.8 B16): what fields under 300 characters carry, approved with the answer. */
function Short({ text, tone = META }: { text: string | undefined; tone?: string }) {
  if (!text) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className={tone}>{ME_SHORT_LABEL}</span>
      <p className="whitespace-pre-wrap text-[15px] leading-[1.6]">{text}</p>
    </div>
  );
}

/** One row: the label, the input and Save; an approvable field with a value gets its approval control. */
function Field({ f, csrf, saved = null }: { f: MeField; csrf: string; saved?: string | null }) {
  const id = `f-${f.path}`;
  // The empty add row has no one to remove (v6.1.9 N10).
  const hint = /^team\.\d+\.name$/.test(f.path) && f.value === '' ? undefined : hintOf(f.path);
  return (
    <div className="flex flex-col gap-2 border-t border-s-line py-4 first:border-t-0 md:grid md:grid-cols-[220px_1fr] md:gap-x-5">
      <label htmlFor={id} className="flex flex-col gap-0.5 text-[15px] text-s-text md:pt-2.5">
        {f.label}
        {f.set_by === 'agent' && <span className={META}>{ME_BY_AGENT}</span>}
      </label>
      <div className="flex min-w-0 flex-col gap-2">
        <form method="post" action="/me/edit" className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Csrf token={csrf} />
          <input type="hidden" name="path" value={f.path} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input f={f} id={id} />
            {hint && <span className={META}>{hint}</span>}
          </div>
          <button type="submit" className={`${SAVE} self-start`}>
            {ME_SAVE}
          </button>
          <Saved on={saved === f.path} />
        </form>
        <Short text={f.short} />
        {f.approvable && f.value !== '' && (
          <Approval path={approvalPathOf(f.path)} approvedOn={f.approved_on} seen={f.seen} csrf={csrf} />
        )}
      </div>
    </div>
  );
}

function Card({ id, title, card = CARD_PANEL, children }: { id: string; title: string; card?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${card.replace('rounded-[36px]', 'rounded-[28px] md:rounded-[36px]')} flex scroll-mt-24 flex-col gap-3 p-5 md:p-8`}>
      <h2 id={`${id}-title`} className={TITLE}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The projects block: one inner card per project. */
function Projects({ fields, seen, csrf, saved }: { fields: MeField[]; seen: MeData['projects_seen']; csrf: string; saved: string | null }) {
  // L21-12 (v6.1.16): the empty line only when the record holds no project and no application names one.
  if (fields.length === 0 && seen.length === 0) return <p className="text-[15px] text-s-muted">{ME_NO_PROJECTS}</p>;
  const byId = new Map<string, MeField[]>();
  for (const f of fields) {
    const id = f.path.split('.')[1];
    byId.set(id, [...(byId.get(id) ?? []), f]);
  }
  return (
    <div className="flex flex-col gap-3">
      {[...byId.entries()].map(([id, fs]) => (
        <div key={id} className="rounded-[24px] bg-s-panel-inner px-4 py-2 md:px-6">
          <h3 className="ek-serif pt-3 text-[24px] leading-none">{fs.find((f) => f.path.endsWith('.name'))?.value || id}</h3>
          {fs.map((f) => (
            <Field key={f.path} f={f} csrf={csrf} saved={saved} />
          ))}
        </div>
      ))}
      {seen.length > 0 && (
        <ul className="flex flex-col gap-1 px-1">
          {seen.map((p) => (
            <li key={p.key} className="text-[15px] text-s-muted">
              <bdi>{p.label}</bdi>
              {p.line.slice(p.label.length)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The standing approval: one form for the switch and the limits, then the skip list as its own row. */
function Policy({ fields, csrf, saved }: { fields: MeField[]; csrf: string; saved: string | null }) {
  const v = (key: string) => fields.find((f) => f.path === `policy.${key}`)?.value ?? '';
  const cats = v('categories').split(', ');
  const L = ME_LABELS;
  const box = 'flex min-h-11 items-center gap-3 text-[15px]';
  return (
    <>
      <p className="text-[15px] text-s-muted">{ME_POLICY_LINE}</p>
      <form method="post" action="/me/policy" className="flex flex-col gap-3">
        <Csrf token={csrf} />
        <label className={box}>
          <input type="checkbox" name="auto_apply" defaultChecked={v('auto_apply') === 'true'} className="h-5 w-5 accent-s-blue" />
          {L['policy.auto_apply']}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[15px]">
            {L['policy.max_per_night']}
            <input name="max_per_night" inputMode="numeric" defaultValue={v('max_per_night')} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-[15px]">
            {L['policy.max_ask_usd']}
            <input name="max_ask_usd" inputMode="decimal" defaultValue={v('max_ask_usd')} className={INPUT} />
          </label>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[15px]">{L['policy.categories']}</legend>
          <div className="flex flex-wrap gap-x-6">
            {(fields.find((f) => f.path === 'policy.categories')?.options ?? []).map((c) => (
              <label key={c} className={box}>
                <input type="checkbox" name="categories[]" value={c} defaultChecked={cats.includes(c)} className="h-5 w-5 accent-s-blue" />
                {ME_CHOICES[c] ?? c}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={box}>
          <input type="checkbox" name="agent_may_submit" defaultChecked={v('agent_may_submit') === 'true'} className="h-5 w-5 accent-s-blue" />
          {L['policy.agent_may_submit']}
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${SAVE} self-start`}>
            {ME_SAVE}
          </button>
          <Saved on={saved === 'policy'} />
        </div>
      </form>
      {fields.filter((f) => f.path === 'policy.never').map((f) => (
        <Field key={f.path} f={f} csrf={csrf} saved={saved} />
      ))}
    </>
  );
}

/**
 * `saved`: the path (or 'policy') a save came back from; its `Saved.` shows beside that control, not as a banner.
 * With a linked agent the page carries `data-me-linked`, so the header hides its install pill (L21-22, v6.1.16).
 */
export default function MeView({ data, problem, note = null, saved = null }: { data: MeData; problem: string | null; note?: string | null; saved?: string | null }) {
  const { csrf } = data;
  const savedAt = note === ME_SAVED ? saved : null;
  const banner = savedAt ? null : note;
  return (
    <div {...(data.installations.length > 0 ? { 'data-me-linked': '' } : {})} className={`${PAGE_COL} flex flex-col gap-4 pb-10 pt-6 md:pt-10`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className={H1_SITE}>{ME_TITLE}</h1>
          <p className="text-[15px] text-s-muted">{ME_SIGNED_IN(data.login)}</p>
        </div>
        <form method="post" action="/me/signout">
          <Csrf token={csrf} />
          <button type="submit" className={GHOST}>
            {ME_SIGN_OUT}
          </button>
        </form>
      </div>

      {problem && (
        <p role="alert" className={`${CARD_RUST.replace('rounded-[36px]', 'rounded-[24px]')} whitespace-pre-line px-5 py-4 text-[15px] text-s-rust-light`}>
          {problem}
        </p>
      )}

      {banner && (
        <p role="status" className={`${CARD_PANEL.replace('rounded-[36px]', 'rounded-[24px]')} px-5 py-4 text-[15px] text-s-good-text`}>
          {banner}
        </p>
      )}

      {data.link && (
        <Card id="link" title={data.link.title} card={CARD_NAVY}>
          {data.link.text && <p className="text-[15px] leading-[1.6] text-s-on-navy-soft">
            {data.link.parts ? (
              <>
                {data.link.parts[0]}
                <bdi>{data.link.parts[1]}</bdi>
                {data.link.parts[2]}
              </>
            ) : (
              data.link.text
            )}
          </p>}
          {data.link.code && (
            <div className="flex flex-wrap gap-3">
              {(['link', 'deny'] as const).map((action) => (
                <form key={action} method="post" action="/me/link">
                  <Csrf token={csrf} />
                  <input type="hidden" name="code" value={data.link!.code!} />
                  <input type="hidden" name="action" value={action} />
                  <button type="submit" className={action === 'link' ? SAVE : GHOST}>
                    {action === 'link' ? ME_LINK_YES : ME_LINK_NO}
                  </button>
                </form>
              ))}
            </div>
          )}
        </Card>
      )}

      {data.pending_approvals.length > 0 && (
        <Card id="approvals" title={ME_PENDING_TITLE} card={CARD_NAVY}>
          <p className="text-[15px] text-s-on-navy-soft">{ME_PENDING_LINE}</p>
          <ul className="flex flex-col gap-2.5">
            {data.pending_approvals.map((p) => (
              <li key={p.path} className="flex flex-col gap-2 rounded-[24px] bg-s-navy-inner p-4 md:p-5">
                <span className="text-[13px] text-s-on-navy">{p.label}</span>
                <p className="whitespace-pre-wrap text-[15px] leading-[1.6]">{p.text}</p>
                <Short text={p.short} tone="text-[13px] text-s-on-navy" />
                <Approval path={p.path} approvedOn={null} seen={p.seen} csrf={csrf} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.blocks.map((b) => (
        <Card key={b.key} id={b.key} title={b.title}>
          {b.key === 'projects' ? (
            <Projects fields={b.fields} seen={data.projects_seen} csrf={csrf} saved={savedAt} />
          ) : b.key === 'policy' ? (
            <Policy fields={b.fields} csrf={csrf} saved={savedAt} />
          ) : (
            <div>
              {b.fields.map((f) => (
                <Field key={f.path} f={f} csrf={csrf} saved={savedAt} />
              ))}
            </div>
          )}
        </Card>
      ))}

      <Card id="ledger" title={ME_LEDGER_TITLE}>
        {data.ledger_line && <p className="text-[15px]">{data.ledger_line}</p>}
        {data.ledger.length === 0 ? (
          <p className="text-[15px] text-s-muted">{ME_LEDGER_EMPTY}</p>
        ) : (
          <ul>
            {data.ledger.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-s-line py-3 text-[15px] first:border-t-0">
                <span className="min-w-0">{l.title}</span>
                <span className="text-s-muted">{l.words}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="agents" title={ME_AGENTS_TITLE}>
        {data.installations.length === 0 ? (
          <p className="text-[15px] text-s-muted">{ME_AGENTS_EMPTY}</p>
        ) : (
          <ul>
            {data.installations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-s-line py-3 text-[15px] first:border-t-0">
                <span className="flex flex-col">
                  <bdi>{a.label}</bdi>
                  {a.linked_at && <span className={META}>{ME_LINKED(a.linked_at)}</span>}
                </span>
                <form method="post" action="/me/unlink">
                  <Csrf token={csrf} />
                  <input type="hidden" name="installation_id" value={a.id} />
                  <button type="submit" className={GHOST}>
                    {ME_UNLINK}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {data.reviews.map((line) => (
          <p key={line} className="text-[15px] text-s-muted">
            {line}
          </p>
        ))}
      </Card>

      <Card id="delete" title={ME_DELETE_TITLE} card={CARD_RUST}>
        <p className="text-[15px] leading-[1.6] text-s-rust-sub">{ME_DELETE_LINE}</p>
        <form method="post" action="/me/delete" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Csrf token={csrf} />
          <input name="confirm" aria-label={ME_DELETE_HINT} placeholder={data.login} autoComplete="off" className={`${INPUT} sm:max-w-[320px]`} />
          <button type="submit" className={`${SAVE} self-start sm:self-auto`}>
            {ME_DELETE}
          </button>
        </form>
        <p className="text-[13px] text-s-rust-sub">{ME_DELETE_HINT}</p>
      </Card>
    </div>
  );
}
