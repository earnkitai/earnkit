### Task 16 (release 1): the replies, rewritten for a busy builder (owner-approved copy, 2026-10-21) (I: Opus, R: Opus)

Owner approved this exact copy on 2026-10-21 ("Awesome approved"), with two rulings: no points on profile pages, no points for applying. It supersedes the reply layout of Tasks 2, 4 and 6 (headers "Where you stand" / "Ways to get funded" / "How to move up" go away everywhere) but keeps their logic (connect, apply, backing, share, ship order; Best fit choice; RANK_MIN_POOL; one https link and one question per reply).

Format rules: plain text, no markdown, no headers; short lines; a blank line between the explanation, the action and the points line; " · " joins facts on one line; one https link; exactly one question; the last line is the points line when the step earns points; no em dashes; every number real.

Exact copy (placeholders in <>; `<org>`/`<prize>` = the Best fit program's organizer and its max award, e.g. "Base", "$5,000"; `<program>` = its short title, e.g. "Base Builder Grant"; `<name>` = the project's display name; `<handle>` = X handle; `<page>` = earnkit.com/<handle> without scheme unless it is the reply's one link):

1. Signed out, first reply after install:
```
EarnKit gets you paid for building.
I read your commits every week, rank you against other builders, and find grants you qualify for. <org> pays up to <prize> right now.

Step 1 of 2: sign in with X (one click): <sign-in link>
Done?
+30 points when you finish step 2
```
(With no open grant to name, drop the "<org> pays..." sentence.)

2. Signed in, no repo (repo picker) and repo named but not counted (install link):
```
You're in, @<handle>.
Step 2 of 2: pick the repo you're building. I only get read access (one click): <install link>
Done?
+30 points when it's connected
```

3. First ranked reply with unapproved weeks (connect):
```
<name> is on the leaderboard: #<rank> of <N> builders, <S> weeks in a row.
You qualify for the <program>, up to <prize>.

Post your <W> weeks to <page> so grant teams can see them?
+<P> points
```
Under RANK_MIN_POOL ranked builders the first line is `<name> is on EarnKit: <S> weeks in a row.` With no Best fit, drop the "You qualify" line. <W> = weeks offered; <P> = the points this yes will add (ledger: connect points plus the approved weeks' rank points), never invented.

4. After the connect yes:
```
You're live: <page link>
Next, I can write your <program> application. You just check it and send.
Want me to?
+<added> points added · <total> total
```
With no Best fit: `You're live: <page link>` then the weekly email question as today, and the points line.

5. Ranked, no connect pending ("where do I stand"), apply step:
```
<name> · #<rank> of <N> builders · <S> weeks in a row
<program> is still open, up to <prize>. I can draft it in a minute.
Want me to?
Ship code this week: up to +<max> points
```
<max> = points for rank 1 (100). Backing, share and ship steps keep this layout: line 1 the standing, line 2 the money (the Best fit or the backing line), line 3 the one question, last line the points line.

6. The draft (prepare, Base prefilled):
```
Your <program> application is ready. I filled <F> of <T> answers from your work.
You add: <short list of blank fields>.

Open the form, your answers are already in it: <form link>
Sent it?
```
No points line (owner: no points for applying). Copy-and-paste drafts keep Task 9's answers block between line 2 and the open line, and the https:// paste line.

7. Monday (weekly moment):
```
Week <n> done. You're <still #r | now #r | on EarnKit>: +<pts> points.
A post for X, ready to paste:
"Week <n> shipping <name>. <page>"
Does last week look right?
```

Pages never show points (owner, 2026-10-21). Update every test that asserts the old layout; add one test per reply above that asserts the exact text (with fixture values), one https link and exactly one question.
