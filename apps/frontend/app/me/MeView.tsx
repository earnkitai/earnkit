import { CARD_NAVY, CARD_PANEL, CARD_RUST, H1_SITE, PAGE_COL, PILL_WHITE } from '../components/site/ui';
import {
  ME_AGENTS_EMPTY, ME_AGENTS_TITLE, ME_APPROVE, ME_APPROVED, ME_BY_AGENT, ME_CHOICES, ME_DELETE, ME_DELETE_HINT,
  ME_ANSWER_OPEN, ME_DELETE_LINE, ME_DELETE_TITLE, ME_HINTS, ME_LABELS, ME_LEDGER_EMPTY, ME_LEDGER_TITLE, ME_LINK_NO, ME_LINK_YES, ME_LINKED, ME_NO, ME_NO_PROJECTS, ME_NOT_SET,
  ME_PENDING_ANSWERS, ME_PENDING_FIRST, ME_PENDING_LINE, ME_PENDING_TITLE, ME_WAITING, ME_POLICY_LINE, ME_SAVE, ME_SAVED, ME_SHORT_LABEL, ME_SIGN_OUT, ME_SIGNED_IN, ME_TEAM, ME_TITLE, ME_UNAPPROVE, ME_UNLINK, ME_YES,
  ME_NOT_SET_YET, ME_SENT_IT,
} from '../../lib/v5/site-copy';
import { approvalPathOf, firstLineOf, isAnswerPath, type MeData, type MeField } from '../../lib/v6/me-view';

/** /me: plain HTML forms only (no client script); every form carries the day's csrf token. */
const TITLE = 'ek-serif text-[32px] leading-none';
/** L27-12 (v6.1.16): the field edge is s-field-line, 4.71:1 on the page (3:1 is the floor). */
const INPUT = 'min-h-11 w-full rounded-[16px] border border-s-field-line bg-s-panel-inner px-4 py-2.5 text-[15px] text-s-text';
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

/** A placed note (L43-6, L43-1, L43-9, v6.1.19): `Nothing to save.`, `Saved and approved.`, `Sent {title}.` beside its control. */
function Note({ text }: { text: string | null }) {
  return text ? (
    <span role="status" className="self-center text-[15px] text-s-good-text">
      {text}
    </span>
  ) : null;
}

/**
 * A line that may quote an agent's own name (L43-10, v6.1.19: `Unlinked "{name}".`, `Linked: "{name}".`): the quoted
 * name isolated in `<bdi>`, as the link lines show it. React escapes every part.
 */
function Quoted({ text }: { text: string }) {
  const m = /^([^"]*)("[^"]*")([^"]*)$/.exec(text);
  return m ? (
    <>
      {m[1]}
      <bdi>{m[2]}</bdi>
      {m[3]}
    </>
  ) : (
    <>{text}</>
  );
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

/** A field's control (L27-8, L27-29, v6.1.16): named by its path, in its section's form (`form`), described by its hint. */
function Input({ f, id, form, hint }: { f: MeField; id: string; form: string; hint?: string }) {
  // L43-4 (v6.1.19): after a refusal the box holds what was typed (escaped by React as every value).
  const common = { id, name: f.path, form, defaultValue: f.typed ?? f.value, className: INPUT, ...(hint ? { 'aria-describedby': hint } : {}) };
  if (f.kind === 'bool' || f.kind === 'choice') {
    const options: [string, string][] = f.kind === 'bool' ? [['true', ME_YES], ['false', ME_NO]] : (f.options ?? []).map((o) => [o, ME_CHOICES[o] ?? o]);
    return (
      <select {...common}>
        <option value="">{ME_NOT_SET}</option>
        {options.map(([v, words]) => (
          <option key={v} value={v}>
            {words}
          </option>
        ))}
      </select>
    );
  }
  if (f.kind === 'long') return <textarea {...common} rows={4} className={`${INPUT} leading-[1.5]`} />;
  return <input {...common} type={f.kind === 'url' ? 'url' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} />;
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

/**
 * One row (L27-29, v6.1.16): the label, then the input, then the hint as its own element (`{id}-hint`, the input's
 * aria-describedby), with "From your agent" in it when the agent set the value. The input belongs to its section's
 * form (`form`), so the section has one Save; an approvable field with a value gets its own approval form beside it.
 */
function Field({ f, csrf, form, inline = null }: { f: MeField; csrf: string; form: string; inline?: React.ReactNode }) {
  const id = `f-${f.path}`;
  // The empty add row has no one to remove (v6.1.9 N10).
  const hint = /^team\.\d+\.name$/.test(f.path) && f.value === '' ? undefined : hintOf(f.path);
  const hintId = hint || f.set_by === 'agent' ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-2 border-t border-s-line py-4 first:border-t-0 md:grid md:grid-cols-[220px_1fr] md:gap-x-5">
      <label htmlFor={id} className="text-[15px] text-s-text md:pt-2.5">
        {f.label}
      </label>
      <div className="flex min-w-0 flex-col gap-2">
        {inline}
        <Input f={f} id={id} form={form} hint={hintId} />
        {hintId && (
          <p id={hintId} className={`${META} flex flex-col gap-0.5`}>
            {f.set_by === 'agent' && <span>{ME_BY_AGENT}</span>}
            {hint && <span>{hint}</span>}
          </p>
        )}
        <Short text={f.short} />
        {f.approvable && f.value !== '' && isAnswerPath(f.path) && !f.approved_on ? (
          // L43-1 (v6.1.19): an open answer's Approve submits its section's form, so the box's text is what is approved
          // (saved first when it was edited); the form carries the answer's `seen`.
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" form={form} formAction="/me/approve" name="approve" value={f.path} className={SAVE}>
              {ME_APPROVE}
            </button>
          </div>
        ) : f.approvable && f.value !== '' ? (
          <Approval path={approvalPathOf(f.path)} approvedOn={f.approved_on} seen={f.seen} csrf={csrf} />
        ) : null}
      </div>
    </div>
  );
}

/** The link that opens one answer (L35-24, v6.1.17 Task 4): the page again with only that one open, at its anchor. */
const openHref = (path: string, anchor: string) => `/me?open=${encodeURIComponent(path)}#${anchor}`;
const OPEN_LINK = 'inline-flex min-h-11 items-center underline';
/**
 * The answer rows' look, set once on their container (L35-24, v6.1.17 Task 4): a 154-answer record repeats each row,
 * so the rows carry no classes of their own.
 */
const ANSWER_ROWS = [
  '[&>details]:border-t [&>details]:border-s-line [&>details:first-child]:border-t-0',
  '[&_summary]:cursor-pointer [&_summary]:py-3 [&_summary]:text-[15px] [&_summary>span]:block [&_summary>span]:break-words',
  '[&_summary>span+span]:text-s-muted [&_summary>strong]:block [&_summary>strong]:text-[13px] [&_summary>strong]:text-s-text',
  `[&_summary+a]:inline-flex [&_summary+a]:min-h-11 [&_summary+a]:items-center [&_summary+a]:underline`,
].join(' ');

/** Where a line shows (L43-5, v6.1.19): the open answer's own refusal, `Saved.` or note sit inside it, above its box. */
type Placed = { problem: string | null; saved: boolean; note: string | null };
const NONE: Placed = { problem: null, saved: false, note: null };

/**
 * An answer (L35-24, v6.1.17 Task 4): a `<details>` collapsed to its label and first line (styled by ANSWER_ROWS on its
 * container). The one named by `?open=` is open with its field and only its label in the summary (L43-15, v6.1.19:
 * the box holds the text); any other holds only the link that opens it, so a record of 154 answers stays a small page
 * and only one is open at a time, with no script.
 */
function AnswerRow({ f, csrf, form, open, placed = NONE }: { f: MeField; csrf: string; form: string; open: boolean; placed?: Placed }) {
  const id = `a-${f.path}`;
  const inline = open && (placed.problem || placed.saved || placed.note) ? (
    <>
      <Problem text={placed.problem} />
      {placed.saved && <Saved on />}
      <Note text={placed.note} />
    </>
  ) : null;
  return (
    <details id={id} name="answers" open={open}>
      <summary>
        <span>{f.label}</span>
        {!open && <span>{f.value ? firstLineOf(f.value) : `${ME_NOT_SET}.`}</span>}
        {f.approvable && f.value !== '' && !f.approved_on && <strong>{ME_WAITING}</strong>}
      </summary>
      {open ? <Field f={f} csrf={csrf} form={form} inline={inline} /> : <a href={openHref(f.path, id)}>{ME_ANSWER_OPEN}</a>}
    </details>
  );
}

/**
 * L43-16 (v6.1.19): every empty answer folded into one row, `Not set yet: {n} answers.`, its body one link per answer
 * that opens it (one click), so a new record shows one row, not 14.
 */
function EmptyAnswers({ fields }: { fields: MeField[] }) {
  if (fields.length === 0) return null;
  return (
    <details id="a-empty" name="answers">
      <summary>
        <span>{ME_NOT_SET_YET(fields.length)}</span>
      </summary>
      <ul className="flex flex-col pb-2">
        {fields.map((f) => (
          <li key={f.path}>
            <a href={openHref(f.path, `a-${f.path}`)} className={OPEN_LINK}>
              {f.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A record row: an answer collapsed (AnswerRow), any other field as it is. */
function Row({ f, csrf, form, open, placed }: { f: MeField; csrf: string; form: string; open: string | null; placed?: Placed }) {
  return isAnswerPath(f.path) ? <AnswerRow f={f} csrf={csrf} form={form} open={open === f.path} placed={open === f.path ? placed : NONE} /> : <Field f={f} csrf={csrf} form={form} />;
}

/** A refusal beside the control it is about (L27-9, v6.1.16). */
function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className={`${CARD_RUST.replace('rounded-[36px]', 'rounded-[20px]')} whitespace-pre-line px-4 py-3 text-[15px] text-s-rust-light`}>
      {text}
    </p>
  ) : null;
}

/** A section's one form (L27-8, L27-10, v6.1.16): the day's token, the section, one Save, `Saved.` and any problem beside it. */
function SectionForm({ id, section, csrf, saved, problem, open = null, seen = null, note = null }: { id: string; section: string; csrf: string; saved: boolean; problem: string | null; open?: string | null; seen?: string | null; note?: string | null }) {
  return (
    <form id={id} method="post" action="/me/edit" className="flex flex-col gap-3 border-t border-s-line pt-4">
      <Csrf token={csrf} />
      <input type="hidden" name="section" value={section} />
      {/* The open answer stays open after its Save (L35-24, v6.1.17 Task 4). */}
      {open && <input type="hidden" name="open" value={open} />}
      {/* L43-1 (v6.1.19): the open answer's Approve is a button of this form; it approves the text shown. */}
      {open && seen !== null && <input type="hidden" name="seen" value={seen} />}
      <Problem text={problem} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={`${SAVE} self-start`}>
          {ME_SAVE}
        </button>
        <Saved on={saved} />
        <Note text={note} />
      </div>
    </form>
  );
}

function Card({ id, title, card = CARD_PANEL, children }: { id: string; title: React.ReactNode; card?: string; children: React.ReactNode }) {
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
function Projects({ fields, seen, csrf, open, placed }: { fields: MeField[]; seen: MeData['projects_seen']; csrf: string; open: string | null; placed: Placed }) {
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
        <div key={id} className={`rounded-[24px] bg-s-panel-inner px-4 py-2 md:px-6 ${ANSWER_ROWS}`}>
          <h3 className="ek-serif pt-3 text-[24px] leading-none">{fs.find((f) => f.path.endsWith('.name'))?.value || id}</h3>
          {fs.map((f) => (
            <Row key={f.path} f={f} csrf={csrf} form="form-projects" open={open} placed={placed} />
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
function Policy({ fields, csrf, saved, problem, status, draft }: { fields: MeField[]; csrf: string; saved: boolean; problem: string | null; status: string[]; draft: MeData['draft'] }) {
  // L43-4 (v6.1.19): after a refusal the form shows what was typed (the draft holds every field of this form).
  const typed = draft && 'policy.auto_apply' in draft ? draft : null;
  const v = (key: string) => typed?.[`policy.${key}`] ?? fields.find((f) => f.path === `policy.${key}`)?.value ?? '';
  const cats = v('categories').split(', ');
  const L = ME_LABELS;
  const box = 'flex min-h-11 items-center gap-3 text-[15px]';
  return (
    <>
      {/* L24-14 (v6.1.16 Task 11): whether it is on, in words, and what went under it. */}
      <p className="text-[15px]">{status.join(' ')}</p>
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
        {/* The skip list is part of the one standing-approval form (L27-8, v6.1.16). */}
        {fields.filter((f) => f.path === 'policy.never').map((f) => (
          <div key={f.path} className="flex flex-col gap-1 text-[15px]">
            <label htmlFor="f-policy.never">{f.label}</label>
            <textarea id="f-policy.never" name="never" defaultValue={v('never')} rows={4} aria-describedby="f-policy.never-hint" className={`${INPUT} leading-[1.5]`} />
            <p id="f-policy.never-hint" className={META}>
              {hintOf(f.path)}
            </p>
          </div>
        ))}
        <Problem text={problem} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${SAVE} self-start`}>
            {ME_SAVE}
          </button>
          <Saved on={saved} />
        </div>
      </form>
    </>
  );
}

/**
 * `saved`: the section a save came back from (L27-10, v6.1.16: `/me?saved={section}#{section}`); its `Saved.` shows
 * beside that section's Save, not as a banner. `at`: the section a refusal is about (L27-9: the delete card for a
 * failed delete); the line shows inside that card, else above the record. With a linked agent the page carries
 * `data-me-linked`, so the header hides its install pill (L21-22, v6.1.16). `open`: the one answer shown in full
 * (L35-24, v6.1.17 Task 4: `?open={path}`); every other answer is its first line, and Waiting for you counts the
 * answers that wait (each is marked in its section) instead of repeating them.
 */
export default function MeView({ data, problem, note = null, saved = null, at = null, open = null }: { data: MeData; problem: string | null; note?: string | null; saved?: string | null; at?: string | null; open?: string | null }) {
  const { csrf } = data;
  // Where a line shows: a card, the delete box, the applications (L43-9), or the open answer itself (L43-5, v6.1.19).
  const placed = new Set<string>([...data.blocks.map((b) => b.key), 'delete', 'ledger', ...(open ? [open] : [])]);
  const isPlaced = at !== null && placed.has(at);
  const banner = note === ME_SAVED || (note && isPlaced) ? null : note;
  const problemIn = (key: string) => (problem && at === key ? problem : null);
  const noteIn = (key: string) => (note && note !== ME_SAVED && at === key ? note : null);
  const topProblem = problem && !isPlaced ? problem : null;
  const inAnswer: Placed = open && at === open ? { problem: problemIn(open), saved: saved !== null && note === null && problem === null, note: noteIn(open) } : NONE;
  const waiting = data.pending_approvals.map((p) => p.path).filter(isAnswerPath);
  // L43-4 (v6.1.19): the fields show what was typed before a refusal.
  const draft = data.draft;
  const blocks = draft
    ? data.blocks.map((b) => ({ ...b, fields: b.fields.map((f) => (f.path in draft ? { ...f, typed: draft[f.path] } : f)) }))
    : data.blocks;
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

      {topProblem && (
        <p role="alert" className={`${CARD_RUST.replace('rounded-[36px]', 'rounded-[24px]')} whitespace-pre-line px-5 py-4 text-[15px] text-s-rust-light`}>
          {topProblem}
        </p>
      )}

      {banner && (
        <p role="status" className={`${CARD_PANEL.replace('rounded-[36px]', 'rounded-[24px]')} px-5 py-4 text-[15px] text-s-good-text`}>
          <Quoted text={banner} />
        </p>
      )}

      {data.link && (
        <Card
          id="link"
          // L43-17 (v6.1.19): the live title names the agent, its own name isolated.
          title={data.link.parts ? (
            <>
              {data.link.parts[0]}
              <bdi>{data.link.parts[1]}</bdi>
              {data.link.parts[2]}
            </>
          ) : (
            data.link.title
          )}
          card={CARD_NAVY}
        >
          {data.link.text && <p className="text-[15px] leading-[1.6] text-s-on-navy-soft">{data.link.text}</p>}
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
          {/* L35-24 (v6.1.17 Task 4): the answers are counted here; each waits collapsed in its section, Approve inside. */}
          {waiting.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-4 text-[15px]">
              {ME_PENDING_ANSWERS(waiting.length)}
              <a href={openHref(waiting[0], `a-${waiting[0]}`)} className={OPEN_LINK}>
                {ME_PENDING_FIRST}
              </a>
            </p>
          )}
          {data.pending_approvals.length > waiting.length && (
            <ul className="flex flex-col gap-2.5">
              {data.pending_approvals.filter((p) => !isAnswerPath(p.path)).map((p) => (
                <li key={p.path} className="flex flex-col gap-2 rounded-[24px] bg-s-navy-inner p-4 md:p-5">
                  <span className="text-[13px] text-s-on-navy">{p.label}</span>
                  <p className="whitespace-pre-wrap text-[15px] leading-[1.6]">{p.text}</p>
                  <Short text={p.short} tone="text-[13px] text-s-on-navy" />
                  <Approval path={p.path} approvedOn={null} seen={p.seen} csrf={csrf} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {blocks.map((b) => {
        const openHere = open ? b.fields.find((f) => f.path === open) ?? null : null;
        // L43-16 (v6.1.19): Your answers lists the set answers and folds the empty ones into one row (the open one shows).
        const rows = b.key === 'answers' ? b.fields.filter((f) => f.value !== '' || f.path === open) : b.fields;
        const empty = b.key === 'answers' ? b.fields.filter((f) => f.value === '' && f.path !== open) : [];
        return (
          <Card key={b.key} id={b.key} title={b.title}>
            {b.key === 'projects' ? (
              <Projects fields={b.fields} seen={data.projects_seen} csrf={csrf} open={open} placed={inAnswer} />
            ) : b.key === 'policy' ? (
              <Policy fields={b.fields} csrf={csrf} saved={saved === 'policy'} problem={problemIn('policy')} status={data.policy_status ?? []} draft={draft} />
            ) : (
              <div className={b.key === 'answers' ? ANSWER_ROWS : undefined}>
                {rows.map((f) => (
                  <Row key={f.path} f={f} csrf={csrf} form={`form-${b.key}`} open={open} placed={inAnswer} />
                ))}
                <EmptyAnswers fields={empty} />
              </div>
            )}
            {b.key !== 'policy' && b.fields.length > 0 && (
              <SectionForm
                id={`form-${b.key}`}
                section={b.key}
                csrf={csrf}
                saved={saved === b.key && !(open !== null && at === open)}
                problem={problemIn(b.key)}
                note={noteIn(b.key)}
                open={openHere ? open : null}
                seen={openHere ? openHere.seen : null}
              />
            )}
          </Card>
        );
      })}

      <Card id="ledger" title={ME_LEDGER_TITLE}>
        {data.ledger_line && <p className="text-[15px]">{data.ledger_line}</p>}
        {/* L43-9 (v6.1.19): `Sent {title}.` or the refusal, here. */}
        <Problem text={problemIn('ledger')} />
        <Note text={noteIn('ledger')} />
        {data.ledger.length === 0 ? (
          <p className="text-[15px] text-s-muted">{ME_LEDGER_EMPTY}</p>
        ) : (
          <ul>
            {data.ledger.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-s-line py-3 text-[15px] first:border-t-0">
                <span className="min-w-0">{l.title}</span>
                <span className="text-s-muted">{l.words}</span>
                {/* L43-9 (v6.1.19): a claim the builder sent by hand is said sent here, as the sent ask's yes is. */}
                {l.send && (
                  <form method="post" action="/me/sent" className="basis-full">
                    <Csrf token={csrf} />
                    <input type="hidden" name="program_id" value={l.send.program_id} />
                    <input type="hidden" name="project_id" value={l.send.project_id} />
                    <button type="submit" className={GHOST}>
                      {ME_SENT_IT}
                    </button>
                  </form>
                )}
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
        {/* L27-9 (v6.1.16): a visible label, and a refused delete comes back here with its line beside the form. */}
        <form method="post" action="/me/delete" className="flex flex-col gap-2">
          <Csrf token={csrf} />
          {/* L43-11 (v6.1.19): a refused delete shows its one line in the label's place, and the box keeps what was typed. */}
          {problemIn('delete') ? (
            <label htmlFor="delete-confirm" role="alert" className={`${CARD_RUST.replace('rounded-[36px]', 'rounded-[20px]')} whitespace-pre-line px-4 py-3 text-[15px] text-s-rust-light`}>
              {problemIn('delete')}
            </label>
          ) : (
            <label htmlFor="delete-confirm" className="text-[13px] text-s-rust-sub">
              {ME_DELETE_HINT}
            </label>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input id="delete-confirm" name="confirm" placeholder={data.login} defaultValue={draft?.['delete.confirm']} autoComplete="off" className={`${INPUT} sm:max-w-[320px]`} />
            <button type="submit" className={`${SAVE} self-start sm:self-auto`}>
              {ME_DELETE}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
