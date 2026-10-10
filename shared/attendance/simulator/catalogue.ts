import type { ExpectedDay, SimLeaveType, SimPolicy, SimShift } from "./model";
import { layoutOf, referenceDay, type RefDay } from "./reference";
import { makeRng } from "./rng";
import { generateFor } from "./month";
import { simMasters, SIM_DAY, SIM_NIGHT } from "./roster";
import * as S from "./scenarios";

// The scenario catalogue, generated from the code (docs/plans/PHASE_2.md "P2-G
// build design"): every named scenario, in plain words, what it should do to a
// day, and worked examples with the full expected outcome. It exists so a
// person can read what the engine is being held to and say "yes, that is the
// rule" or "no". It is generated, committed as docs/plans/PHASE_2_SCENARIOS.md,
// and a test fails if the committed copy is stale.

const STD: SimPolicy = simMasters("2026-08").policies.find((p) => p.code === "SIM-STD")!;
const STRICT: SimPolicy = simMasters("2026-08").policies.find((p) => p.code === "SIM-STRICT")!;
const PL: SimLeaveType = { code: "SIMPL", name: "paid", paid: true };

const hm = (m: number | null) => (m === null ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

function outcome(e: ExpectedDay | null): string {
  if (!e) return "**no record**";
  const bits = [`**${e.status}**`];
  if (e.firstHalf !== null && e.firstHalf !== e.secondHalf) bits.push(`(first half ${e.firstHalf}, second ${e.secondHalf})`);
  bits.push(`loss of pay ${e.lopDays}`);
  bits.push(e.flags.length ? `flags ${e.flags.join(", ")}` : "no flags");
  if (e.lateInMinutes !== null && e.lateInMinutes > 0) bits.push(`late ${e.lateInMinutes} min`);
  if (e.earlyOutMinutes !== null && e.earlyOutMinutes > 0) bits.push(`early ${e.earlyOutMinutes} min`);
  if (e.actualMinutes !== null) bits.push(`work ${hm(e.actualMinutes)}`);
  if (e.punchCount !== 0 || e.collapsedPunches) bits.push(`${e.punchCount} punch${e.punchCount === 1 ? "" : "es"}${e.collapsedPunches ? ` (${e.collapsedPunches} duplicate${e.collapsedPunches === 1 ? "" : "s"} collapsed)` : ""}`);
  if (e.workedOnOffDay) bits.push("worked on a day off");
  return bits.join(", ");
}

function refFor(shift: SimShift, policy: SimPolicy, g: S.Generated, over: Partial<RefDay> = {}): ExpectedDay | null {
  return referenceDay({
    date: "2026-08-12",
    employed: true,
    holiday: null,
    weekOff: false,
    leave: { first: null, second: null },
    capture: g.manual ? "MANUAL" : "DEVICE",
    manual: g.manual ?? null,
    punches: g.punches.filter((p) => p.delivery !== "stale").map((p) => p.at),
    flaggedExcluded: g.punches.filter((p) => p.delivery === "stale").length,
    outsideWindowPunches: g.outside?.length ?? 0,
    shift,
    policy,
    ...over,
  });
}

function examples(s: S.Scenario, shift: SimShift, policy: SimPolicy, want: number): Array<{ g: S.Generated; e: ExpectedDay | null }> {
  const out: Array<{ g: S.Generated; e: ExpectedDay | null }> = [];
  const seen = new Set<string>();
  for (let seed = 1; seed < 400 && out.length < want; seed++) {
    const g = generateFor(s, shift, policy, seed);
    if (!g) continue;
    const e = refFor(shift, policy, g);
    const key = `${e?.status}|${(e?.flags ?? []).join(",")}|${e?.lopDays}|${e?.punchCount}|${e?.collapsedPunches}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ g, e });
  }
  return out;
}

export function renderCatalogue(): string {
  const lines: string[] = [];
  lines.push(
    "# Phase 2 — the punch simulator's scenarios, and what the engine is held to",
    "",
    "*Generated from the code by `npm run catalogue --prefix biometric-agent`. Do not edit by hand: a test fails if this file is stale.*",
    "",
    "Each scenario builds an employee-day's punches (or manual entry) from seeded parameters and **declares what should happen**. The month replay (`npm run test:replay --prefix backend`, and a 40-employee version in every CI run) feeds a month of these through the real ingestion service and the real recompute path, then fails if any stored employee-day differs from its scenario's expected outcome.",
    "",
    "**If you disagree with an outcome below, that is a finding about the rule, not a test to quiet.** The tests can only check the engine against these statements; whether the statements are right is what reading this page is for.",
    "",
    "## The test organisation",
    "",
    "The simulator runs a made-up organisation. Its masters are round numbers of its own, deliberately *not* HR's policy (whose grace and thresholds are HR's to confirm).",
    "",
    "| | |",
    "|---|---|",
    `| **SIM-DAY** | ${SIM_DAY.start}–${SIM_DAY.end}; work ${SIM_DAY.sessions[0]!.start}–${SIM_DAY.sessions[0]!.end} and ${SIM_DAY.sessions[2]!.start}–${SIM_DAY.sessions[2]!.end}, lunch ${SIM_DAY.sessions[1]!.start}–${SIM_DAY.sessions[1]!.end}; grace ${SIM_DAY.graceInMinutes} min in and ${SIM_DAY.graceOutMinutes} min out (so on time means in by ${"10:10"} and out from ${"18:50"}); punch window ${SIM_DAY.windowBeforeMinutes / 60} h before the start to ${SIM_DAY.windowAfterMinutes / 60} h after the end |`,
    `| **SIM-NIGHT** | ${SIM_NIGHT.start}–${SIM_NIGHT.end} (crosses midnight, belongs to its START date); work ${SIM_NIGHT.sessions[0]!.start}–${SIM_NIGHT.sessions[0]!.end} and ${SIM_NIGHT.sessions[2]!.start}–${SIM_NIGHT.sessions[2]!.end}, break ${SIM_NIGHT.sessions[1]!.start}–${SIM_NIGHT.sessions[1]!.end}; same grace and window |`,
    `| **SIM-STD** | a full day needs ${STD.fullDayMinMinutes / 60} h of work, a half day ${STD.halfDayMinMinutes / 60} h; under the half-day minimum is absent with ${STD.halfDayMinNotMetLopDays} day's loss; punches within ${STD.nearDuplicateSeconds} s count once |`,
    `| **SIM-STRICT** | a full day needs ${STRICT.fullDayMinMinutes / 60} h, a half day ${STRICT.halfDayMinMinutes / 60} h; under the half-day minimum costs ${STRICT.halfDayMinNotMetLopDays} day |`,
    "| **Week-offs** | Sunday for most; Sunday and the 2nd and 4th Saturday for some |",
    "| **Leave** | `SIMPL` (paid) and `SIMLOP` (unpaid), full days and either half |",
    "",
    "The punch window decides which date a punch counts toward; a night shift's punches after midnight stay on the date the shift **started**.",
    "",
    "## The scenarios",
    "",
  );
  const working = S.WORKING_DAY_SCENARIOS.map(([s]) => s);
  for (const s of working) {
    lines.push(`### \`${s.name}\``, "", `**What it does.** ${s.description}`, "", `**What should happen.** ${s.intentText}`, "");
    const ex = examples(s, SIM_DAY, STD, 3);
    if (ex.length) {
      lines.push("Worked examples (SIM-DAY, SIM-STD):", "");
      for (const { g, e } of ex) lines.push(`- ${g.why} → ${outcome(e)}`);
      lines.push("");
    }
    const strict = examples(s, SIM_DAY, STRICT, 1);
    const night = examples(s, SIM_NIGHT, STD, 1);
    if (night.length) lines.push(`On the night shift: ${night[0]!.g.why} → ${outcome(night[0]!.e)}`, "");
    if (!strict.length) lines.push("Not buildable under SIM-STRICT (its minimums leave no room for this case), so those employees get a normal day instead.", "");
  }
  lines.push("### The other scenarios", "");
  for (const info of S.SCENARIO_INFO.filter((i) => !working.some((w) => w.name === i.name))) {
    lines.push(`- **\`${info.name}\`** — ${info.description} **Should:** ${info.intentText}`);
  }
  lines.push("", "### Worked examples of the rest", "");
  const leaveWorked = S.leaveHalfWorked({ rng: makeRng(3), shift: SIM_DAY, policy: STD, layout: layoutOf(SIM_DAY) }, "first", "SIMPL", false);
  if (leaveWorked) lines.push(`- First-half paid leave, second half worked: ${leaveWorked.why} → ${outcome(refFor(SIM_DAY, STD, leaveWorked, { leave: { first: PL, second: null } }))}`);
  lines.push(`- Full-day unpaid leave → ${outcome(refFor(SIM_DAY, STD, S.leaveFull("SIMLOP", true), { leave: { first: { code: "SIMLOP", name: "u", paid: false }, second: { code: "SIMLOP", name: "u", paid: false } } }))}`);
  lines.push(`- Manual capture, nothing entered → ${outcome(refFor(SIM_DAY, STD, S.manualNothing(), { capture: "MANUAL" }))}`);
  lines.push(`- Not employed on the date → ${outcome(null)}`);
  lines.push("");
  return lines.join("\n");
}
