# Continuity and recovery — when a director is unavailable or locked out

Written at Stage 0.6 of the master build. It documents **only what exists in the code today** (after D1, commit
`77cc7a7`); what is missing, and what the owners must decide, is listed at the end. No real names, accounts or
addresses appear here. Companion to `GETTING_STARTED.md` §12 (the exact commands) and
`plans/DIRECTOR_AUTHORITY.md` (the design).

**Who is a director.** Every *active* Super Admin. There are meant to be exactly two. The payroll roles
(`PAYROLL_ADMIN`, `PAYROLL_APPROVER`) can only be held by a Super Admin (a ceiling in the resolver, the service and a
database trigger); they are markers, not a separate team.

**The one hard guarantee.** The last active Super Admin can never be lost: deactivating, removing the role from, or
separating the only active one is refused by the API and by database triggers.

## (a) One director is unavailable (away, ill, left the room)

What works today:
- Everything the *other* director can do alone. Rule/component confirmation, run approval, finalise, publish, bank file,
  unlock and salary revision each need **a different person than the one who prepared them** today (the payroll flows
  are still on the two-person path until D2 wires them to director authority). So with one director away, **a step the
  remaining director prepared cannot be approved by them**; it waits. Nothing is bypassed and nothing is lost: the
  request stays PENDING and is voided only if the figures change.
- After D2 (not built yet): a step whose second-director switch is OFF (the default for every step) is done by one
  director alone, recorded, and the other director gets a notice and, after 3 days unacknowledged, a red banner.
- Either director can turn any step's second-director check on or off at once (needs two-step sign-in, outside
  development); the other director is notified and sees a red banner. This switch exists now but nothing reads it
  until D2.
- HR keeps its own work (employee records, and whichever attendance capabilities are switched on) with no pay data.

What does not work: anything that is hard-locked to the two directors (HR cannot stand in), and any step that is on
the two-person path while one director is away.

## (b) One director's login is lost (forgotten password, lost authenticator)

Work down this list, stop at the first that applies. Verify identity out of band first (in person, or a call to a known
number), never on an email or chat message.
1. The **other director** does it in the app: profile → Access → Security → *Reset 2FA*, *Send password reset*, or
   *Unlock*. Each asks for a reason, is audit-logged, signs the person out everywhere where relevant, and emails the
   person. Nobody can do it to themselves.
2. Forgotten password but 2FA and email still work: *Forgot password* on the sign-in page.
3. The other director cannot help: the break-glass command `npm run admin:recover` (run on the server, `GETTING_STARTED.md`
   §12). It is loud on purpose: every active Super Admin and `SECURITY_ALERT_EMAIL` are emailed first, a
   `security.breakglass` log line is written outside the database, and a red banner stays up for every Super Admin
   until a director *other than the one recovered* acknowledges it.

## (c) Both directors are locked out

- If the app is running: `npm run admin:recover` for each person (step b.3). It works on Super Admin accounts only and
  can only reset 2FA, unlock, or issue a password-reset link. It never sets a password and never grants a role.
- If **no** Super Admin exists (fresh database, or a bad data change): `npm run admin:bootstrap` creates the first one.
  It refuses if any active Super Admin exists. Before it creates anything it runs the alerting preflight and refuses in
  an environment that cannot tell anyone it happened (`npm run admin:preflight` first).
- If the app cannot run at all: the last-resort SQL in `GETTING_STARTED.md` §12 step 4 (clears 2FA and the lockout for
  one person, writes an audit row). This path is **not loud**; tell the other director yourself and record it outside
  the system.
- Safeguard and its honest limit: someone with server access who chooses not to use these tools is stopped only by the
  record kept outside the database (CloudWatch, ECS Exec session logs, CloudTrail). Keep server access to the owners.

## (d) Two-step sign-in for both directors, before real use

- Outside development, `SUPER_ADMIN` is always in the "must use 2FA" set; it cannot be removed from it (settings
  validator, service, and the resolver all refuse).
- A director action on authority, a switch change and a notice acknowledgement are refused until that director has
  turned on two-step sign-in (`DIRECTOR_2FA_REQUIRED`).
- Steps for each director, before any real payroll: sign in → profile → Security → turn on the authenticator → store the
  backup codes **somewhere other than the same phone**. Do this for **both** directors, and test that each can sign in
  again from a fresh browser.
- D2 will make "every Super Admin has two-step sign-in" a required row of the *Ready for first real run* checklist; D3
  states it as a go-live condition in `FIRST_REAL_PAYROLL_RUN.md`. Neither is done yet.

## (e) What is missing, and what the owners must decide

Missing (not built):
- The payroll flows do not yet use director authority (D2). Until then every step still needs a different person.
- The Ready-for-first-run row for directors' 2FA (D2) and the go-live wording (D3).
- No "deputy" or time-limited delegate for a director. By design there is none.
- No automatic reminder that both directors must be able to sign in; the break-glass tools are manual and need server
  access.

Decide (owners):
1. **A third Super Admin.** Today any active Super Admin is a director: a third one could prepare, approve, switch
   checks and see every pay figure, because Super Admin holds every permission in code. Whether a third Super Admin may
   approve payroll is **not decided**; until the owners decide, do not create one. (Recorded in
   `plans/DIRECTOR_AUTHORITY.md` §0 note.)
2. Whether a director may approve a run they prepared — today the code refuses it; see the Stage 0 report. (Open, WAITING ON.)
3. Who holds the server access used by `admin:recover`, and where its off-database record is reviewed.
4. Where each director keeps their 2FA backup codes.
