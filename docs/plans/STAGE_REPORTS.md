# Stage reports

One report per stage, appended as each stage finishes. Plain and short. No real data. See `MASTER_CHECKLIST.md`.

---

## Stage 0 — D1 close-out (commits `f23ff7b` … `ceb2468`)

**Built**
- 0.1 `f23ff7b` Latency harness: the first wait looked for the removed antd `.ant-statistic`; now waits for the home screen's own text.
- 0.2 `e3f2980` `check:sensitive-ui` is its own CI job (it used to be the last step of `latency`, so a red latency hid it). The scan now also
  visits as an HR Admin and a director (admin and own portal), retries aborted navigations.
- 0.3 `7df6020` Same-person tests (below).
- 0.4 `723381b` Docs note on a third Super Admin.
- 0.6 `ca52b9d` `docs/CONTINUITY_AND_RECOVERY.md`.
- 0.7 `ceb2468` Role screens show a purple "Director only" marker on Payroll Admin / Payroll Approver; `docs/plans/D_PHASES.md`.

**0.1 — the latency job (still red; not fixed in full).** Exact cause: the UI pass replaced antd Statistic/Card/List with StatCard/DataTable, and
the simulator (`biometric-agent/src/simulator/latency/run.ts`) still waits for those. I fixed the first wait. Two more are stale: the
"who is in" watcher (looks for `.ant-card` titles "Arrived (" / "Away" and `.ant-list-item`) and the employee-panel watcher
(`.ant-list-item` with the device name). Rewriting them means re-deriving what the new tables render, so it is **not small**: I did not do it. CI run
on `ceb2468`: the job fails at "Measure punch-to-screen latency" after 5 s; everything else is green.

**0.2 — what the scan found, locally.** Scratch DB `wellsure_hr_d1`, demo company seeded, visits as developer, ordinary employee, HR Admin
(admin and own portal) and director (admin and own portal): **314 pages, no secret on any page, and the DEMO COMPANY banner on every one.** In CI
the new `sensitive-ui` job passed on `ceb2468` (about 9 minutes).

**0.3 — same person never maker and checker.**
Tests added: `approvals.test.ts` — one case per approval subject (6) with a person holding Super Admin + `PAYROLL_ADMIN` + `PAYROLL_APPROVER`; refuses
APPROVE and REJECT with `CHECKER_IS_MAKER`, the database CHECK also refuses, a different director still can.
Changed assertions (all made stricter, none weakened):

| File | Test | Old | New | Why still meaningful |
|---|---|---|---|---|
| approvals.test.ts | "the checker is never the maker…" | one case, RUN_APPROVAL only, maker = a normal Super Admin | `describe.each` over all 6 subjects, person holds both marker roles | covers every subject and the two-role case |
| runClosing.test.ts (run approve by maker, finalise decision by maker, publish REJECT by maker, unlock decision by requester) | 4 asserts | status 403 | status 403 **and** code `CHECKER_IS_MAKER` | a 403 for a different reason (missing permission) can no longer pass |
| salary.test.ts | revision decided by its maker | 403 | 403 + `CHECKER_IS_MAKER` | same |
| releases.test.ts | bank file | (none for the requester approving their own request) | requester's APPROVE → 403 `CHECKER_IS_MAKER` | new |

Rule confirmation, component confirmation and the four independent layers were already covered (`rules.test.ts`, `selfConfirmLayers.test.ts`).
**Mutation:** disabling the check in `approvals.decide` fails all 6 new core cases (restored, re-run green). Not mutation-run: the four flow-level
assertions individually (they would fail under the same mutation by construction, but I did not run it), and the database CHECK alone (covered by
`selfConfirmLayers`). Bank/statutory-change confirmation by a second person is not built yet (D2).

**0.5 — what the code does today when a director approves a run they prepared.** `approvals.decide()` refuses it with 403 `CHECKER_IS_MAKER`
("You prepared this, so you cannot be the one who approves it"), and the database CHECK `payroll_approvals_checker_not_maker` refuses it too.
The only path where one director both prepares and decides is `approvals.authorise()` (director authority), which exists but **no payroll flow calls
yet** — D2 wires it. After D2, with a step's switch at its default (second director not required) one director may do both; with the switch ON,
`authorise` refuses (`SECOND_DIRECTOR_REQUIRED`). Nobody can ever approve a change to their own pay. I changed nothing. **Open: WAITING ON the
owners (whether a director approves a run they prepared).**

**0.7 — departments.** Departments are data (a master table edited in Organisation Setup; every screen reads them from the API). No department
name is hardcoded in backend/frontend/shared code or in tests. The development seed (`backend/prisma/seed.ts`) creates five fake departments by
name (Engineering, Human Resources, Sales & Marketing, Operations and one more); that is development-only fake data, not the real company's. The
demo company's own data is separate.

**Tests / numbers.** Full backend suite run alone (no other test process; stack stopped): **160 files, 1,553 tests, all passed**
(`cd backend && npx vitest run`). Backend and frontend `npm run lint` and `typecheck` clean; frontend tests 46 passed; design-token check OK.
`db:drift` not re-run (no schema change since D1). Not re-run this stage: check:popovers.

**CI** (`ceb2468`): green — install-lint-typecheck-test, sensitive-ui, attendance-replay, agent-windows, docker-build. Red — `latency` only
(0.1, pre-existing, understood). Runs on the earlier commits of this stage were still going when I read the last one; they build the same tree.

**Decided by me.** Proceeded with Stages 0–2 although `docs/samples/` is missing (it blocks only Stages 4, 5.4, 6, 8.1); kept the partial latency fix and
reported the rest; `sensitive-ui` job timeout 40 min; retry for aborted navigations; HR and director visits added to the scan; marker role
`directorOnly` flag added to the roles listing; the D-phase list says the master prompt's order (Stage 1 before D2) overrides Q-DA-9.

**Browser walkthrough (desktop, light, scratch DB with the demo company).** Employee home shows the Remote work card with server time and no horizontal scroll; the payslip page offers Raise a query and the employee lands on their ticket; a director marks a person not on payroll and the entry shows "Waiting for a different director"; the other director confirms (toast "Confirmed", row turns Confirmed); the Payslip links page shows Not set and the password-protected PDF as "Needs owner approval", and saving 7 days works; HR sees neither page nor menu entry. The first attempt failed because I had not applied the B6 migration to that scratch database (the page showed the error), not because of a defect.
**Unverified.** The phone-width (390, dark) walkthrough of the new screens did not run: the scripted sign-in timed out and I stopped rather than spend more time. The bank return layout is untested against a real bank file (none exists in the repository). `check:sensitive-ui` and `check:popovers` run in CI only.
