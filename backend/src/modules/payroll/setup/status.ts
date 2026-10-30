import { RULE_CATALOG, type RuleDef } from "@shared/constants/payrollRules";
import { DEVELOPER_ROLE_CODE, SENSITIVE_PERMISSION_KEYS } from "@shared/constants/sensitiveData";
import { env } from "../../../config/env";
import { businessToday } from "../../../lib/businessDate";
import { activeDirectors, choiceFacts, twoFactorEnforced } from "../../../lib/directorAuthority";
import { salariesOn } from "../../../lib/effectiveDating";
import { activeUsersHoldingPermission, resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { getSetting } from "../../../lib/settings";
import { loadItems, summarise, keysIn, type ItemSummary } from "../items";
import { namesOfUsers } from "../names";
import { bankLayoutFacts, listLayouts } from "../run/layouts";
import { AREA_LABEL, AREAS, currentSet, latestSignoff } from "./signoffs";
import type { Blocker, Person, Readiness, SectionId, SetupItem, SetupReport, SetupSection, SetupStatus } from "./types";

// One function that says where every owner-entered thing stands, in words an owner understands (docs/plans/PHASE_6.md §14J). The Setup Checklist shows all of it; "Ready for first real
// run" shows what is still missing. Nothing is stored about readiness: it is worked out from the data each time, and it re-checks for itself that nothing was confirmed by the person who
// entered it, rather than trusting that the confirm button stopped them.

export const DEMO_SETTING = "demo.company";
export const isDemoCompany = (): Promise<boolean> => getSetting<boolean>(DEMO_SETTING, false);

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

const SECTION_TEXT: Record<SectionId, { title: string; intro: string }> = {
  identifiers: { title: "The company's registration numbers", intro: "The numbers the government gave the company (provident fund, ESI, professional tax, labour welfare, tax deduction). They are printed on the statutory files. One person with the right permission enters each; a different person confirms it by typing it again from the company's own letter. Nobody else can see them." },
  law: { title: "Rates and limits set by law", intro: "Percentages, ceilings and rounding rules that come from the law. Some are filled in already from memory and marked unverified. Your accountant or CA checks each against the current notification, and a different person confirms it." },
  company: { title: "Choices for your company", intro: "How your company pays: how a month is divided into days, the payment date, how pay is rounded, who is covered by provident fund and ESI, and similar decisions. Somebody enters each; a different person confirms it." },
  salary: { title: "Salary structures and their components", intro: "How a person's yearly pay is split into basic, allowances and so on. Every part in use has to be confirmed by someone other than the person who wrote it." },
  bank: { title: "The bank file", intro: "The layout of the file your bank takes for bulk transfers, and the company account the salaries are paid from. Both come from the bank. Only people with the bank-layout permission can enter or see them." },
  files: { title: "Statutory files", intro: "The layouts of the provident fund, ESI, professional tax and labour welfare files. These are needed before the filing dates, not before salaries can be paid, so they do not hold up the first run." },
  people: { title: "People's pay details", intro: "Each person's salary, bank account and provident fund number. Whoever enters them cannot be the one to check them: a different person signs off that the whole set was checked." },
  safety: { title: "Safety setup", intro: "Who can prepare and approve payroll, that they use two-step sign-in, and that the person who built the system holds none of the above." },
};
const SECTION_ORDER: SectionId[] = ["identifiers", "law", "company", "salary", "bank", "files", "people", "safety"];

const person = (name: string | undefined, at: string | undefined): Person | null => (name && at ? { name, at } : null);

function governed(summary: ItemSummary): Pick<SetupItem, "status" | "enteredBy" | "confirmedBy" | "detail" | "problem"> {
  const cur = summary.current;
  const problem = cur?.confirmation && cur.authorUserId && cur.confirmation.confirmedByUserId === cur.authorUserId && !cur.confirmation.selfConfirmed ? "This is marked confirmed, but it was confirmed by the person who entered it. That should be impossible. It needs to be entered or confirmed again by two different people." : undefined;
  return {
    status: summary.status,
    enteredBy: cur && cur.authorUserId ? person(cur.authorName, cur.createdAt) : null,
    confirmedBy: cur?.confirmation ? person(cur.confirmation.confirmedByName, cur.confirmation.confirmedAt) : null,
    detail: summary.sourceLabel ?? "Nobody has entered this yet.",
    ...(problem ? { problem } : {}),
  };
}

const RULES_PATH = { label: "Payroll, Rules and Setup", path: "/admin/payroll/rules" };

function ruleItems(rules: ItemSummary[], plain: Map<string, unknown>): SetupItem[] {
  return RULE_CATALOG.map((def: RuleDef, i) => {
    const s = rules[i]!;
    const section: SectionId = def.sensitiveClass ? "identifiers" : def.origin === "STATUTORY" ? "law" : "company";
    const base = governed(s);
    let notRequired = def.notRequiredForFirstRun;
    if (def.key === "FIXED_DAYS_VALUE" && plain.get("PAY_DAYS_BASIS") !== "FIXED_DAYS" && plain.get("LOP_DIVISOR") !== "FIXED_DAYS") notRequired = "Only used if days are counted as a fixed number, which they are not.";
    const question = def.openQuestion && (def.openQuestion.whenValue === undefined || plain.get(def.key) === def.openQuestion.whenValue) ? def.openQuestion.question : undefined;
    return {
      id: `rule:${def.key}`,
      section,
      category: def.group,
      title: def.label,
      why: def.description,
      required: !notRequired,
      ...(notRequired ? { notRequiredReason: notRequired } : {}),
      ...base,
      detail: question ? `${base.detail} It cannot be confirmed yet: a question about it is still open.` : base.detail,
      where: RULES_PATH,
      ...(def.sensitiveClass ? { permissionNote: "Entered by someone with “Company identifiers: enter and reveal”, confirmed by someone else with “Company identifiers: confirm”. Not by an ordinary rules editor, and never by the developer." } : {}),
      ...(question ? { question } : {}),
    };
  });
}

async function peopleItems(): Promise<SetupItem[]> {
  const out: SetupItem[] = [];
  const meta: Record<(typeof AREAS)[number], { id: string; title: string; why: string; where: SetupItem["where"]; note: string }> = {
    SALARIES: { id: "people:salaries", title: "Every person's salary", why: "A payroll run pays the salary on record. Salaries are entered as salary revisions, and a different person approves each revision. When everyone has one, a second person signs off that the whole set was checked against the signed letters.", where: { label: "Payroll, Employee Salaries", path: "/admin/payroll/salaries" }, note: "Entered by people who may prepare salary revisions; checked by a payroll approver who may see salaries." },
    BANK_ACCOUNTS: { id: "people:bank", title: "Every person's bank account", why: "Salaries are paid into the bank account on record on the payment date. Someone without one is held and named, but the first run should not start with that.", where: { label: "Employee profile, or Bulk Import", path: "/admin/employee/import" }, note: "Entered by people who may edit bank details (or by the employee, approved by them); checked by an approver who may see bank details." },
    STATUTORY_IDS: { id: "people:uan", title: "Provident fund numbers (UAN) for the people it covers", why: "The provident fund file cannot be made for a person without a UAN. ESI numbers are checked when the run is calculated.", where: { label: "Employee profile, or Bulk Import", path: "/admin/employee/import" }, note: "Entered by people who may edit statutory details; checked by an approver who may see them." },
  };
  for (const area of AREAS) {
    const set = await currentSet(area);
    const m = meta[area];
    const sign = await latestSignoff(area);
    const names = await namesOfUsers([sign?.signedByUserId ?? "", ...set.authorUserIds]);
    let status: SetupStatus = "PLACEHOLDER";
    let detail: string;
    let problem: string | undefined;
    if (set.total === 0 || set.covered === 0) {
      status = "NOT_SET";
      detail = set.total === 0 ? "There are no active people yet." : `Nobody has ${AREA_LABEL[area]} on record yet (0 of ${set.total}).`;
    } else if (set.covered < set.total) {
      detail = `${set.covered} of ${set.total} people have ${AREA_LABEL[area]} on record. ${set.total - set.covered} still need them.`;
    } else if (!sign) {
      detail = `All ${set.total} are on record. A different person still has to check them and sign off.`;
    } else if (sign.contentHash !== set.contentHash) {
      detail = `All ${set.total} are on record, but something changed after ${names.get(sign.signedByUserId) ?? "someone"} signed off on ${iso(sign.signedAt)}. It needs checking again.`;
    } else {
      status = "CONFIRMED";
      detail = `All ${set.total} are on record and were checked by ${names.get(sign.signedByUserId) ?? "someone"} on ${iso(sign.signedAt)}.`;
      if (set.authorUserIds.includes(sign.signedByUserId) && sign.authority !== "DIRECTOR_AUTHORITY") problem = "The sign-off was given by a person who entered some of what it covers. That should be impossible. It needs signing off again by someone else.";
    }
    out.push({
      id: m.id,
      section: "people",
      title: m.title,
      why: m.why,
      required: true,
      status,
      enteredBy: set.authorUserIds.length ? { name: set.authorUserIds.map((id) => names.get(id) ?? "Someone").join(", "), at: "" } : null,
      confirmedBy: status === "CONFIRMED" && sign ? person(names.get(sign.signedByUserId) ?? "Someone", sign.signedAt.toISOString()) : null,
      detail,
      where: m.where,
      permissionNote: m.note,
      coverage: { covered: set.covered, total: set.total, missing: set.missing },
      signoffArea: area,
      ...(problem ? { problem } : {}),
    });
  }
  return out;
}

async function salaryItems(): Promise<SetupItem[]> {
  const today = businessToday();
  const people = await prisma.employee.findMany({ where: { status: "ACTIVE", dateOfJoining: { lte: today } }, select: { id: true } });
  const rows = [...(await salariesOn(people.map((p) => p.id), today)).values()];
  const usedStructures = new Set(rows.map((r) => r.structureKey));
  const usedComponents = new Set(rows.flatMap((r) => r.lines.map((l) => l.componentCode)));
  const out: SetupItem[] = [];
  const structures = await loadItems("STRUCTURE");
  const components = await loadItems("COMPONENT");
  const structureKeys = keysIn(structures);
  if (structureKeys.length === 0) {
    out.push({ id: "salary:structure", section: "salary", title: "A salary structure to put people on", why: "A structure says how a yearly pay is split into basic, allowances and the rest.", required: true, status: "NOT_SET", enteredBy: null, confirmedBy: null, detail: "No salary structure has been entered yet.", where: { label: "Payroll, Salary Structures", path: "/admin/payroll/structures" } });
  }
  for (const key of structureKeys) {
    const used = usedStructures.has(key);
    out.push({ id: `structure:${key}`, section: "salary", category: "Structures", title: `Salary structure ${key}`, why: used ? "People are on this structure now." : "No one is on this structure yet.", required: used, ...(used ? {} : { notRequiredReason: "Nobody is on this structure yet." }), ...governed(summarise(structures, key)), where: { label: "Payroll, Salary Structures", path: "/admin/payroll/structures" } });
  }
  for (const key of keysIn(components)) {
    const used = usedComponents.has(key);
    out.push({ id: `component:${key}`, section: "salary", category: "Components", title: `Salary component ${key}`, why: used ? "It is part of someone's pay now." : "No one's pay uses this yet.", required: used, ...(used ? {} : { notRequiredReason: "No one's pay uses this component yet." }), ...governed(summarise(components, key)), where: { label: "Payroll, Salary Components", path: "/admin/payroll/components" } });
  }
  return out;
}

async function layoutItems(): Promise<SetupItem[]> {
  const layouts = await listLayouts({ seesBankLayout: false }); // status, who and when: never the layout
  const facts = await bankLayoutFacts();
  const out: SetupItem[] = [];
  for (const l of layouts) {
    const s: ItemSummary = { status: l.status, sourceLabel: l.sourceLabel, current: l.current, lastConfirmed: l.lastConfirmed, history: [] };
    const base = governed(s);
    if (l.key === "BANK_TEMPLATE") {
      out.push({ id: "layout:BANK_TEMPLATE", section: "bank", title: "Bank file layout", why: l.description, required: true, ...base, where: { label: "Payroll, Bank and Statutory Layouts", path: "/admin/payroll/layouts" }, permissionNote: "Entered by someone with “Bank file layout and debit account: enter”, checked by someone else with “…: confirm”. Never by the developer." });
      const debitStatus: SetupStatus = !facts.hasDebitAccount ? "NOT_SET" : l.status;
      out.push({
        id: "bank:debit-account",
        section: "bank",
        title: "The company account salaries are paid from (debit account)",
        why: "The bank file names the company account the money leaves. It is entered with the bank layout and confirmed with it.",
        required: true,
        status: debitStatus,
        enteredBy: facts.hasDebitAccount ? base.enteredBy : null,
        confirmedBy: debitStatus === "CONFIRMED" ? base.confirmedBy : null,
        detail: !facts.hasDebitAccount ? "No debit account has been entered with the bank layout." : debitStatus === "CONFIRMED" ? base.detail : "Entered with the bank layout; waiting for the layout to be confirmed.",
        where: { label: "Payroll, Bank and Statutory Layouts", path: "/admin/payroll/layouts" },
        permissionNote: "Stored encrypted; only its last four digits are ever shown.",
      });
    } else {
      out.push({ id: `layout:${l.key}`, section: "files", title: l.label, why: l.description, required: false, notRequiredReason: "Needed before the filing date, not before salaries can be paid.", ...base, where: { label: "Payroll, Bank and Statutory Layouts", path: "/admin/payroll/layouts" } });
    }
  }
  return out;
}

async function safetyItems(demo: boolean): Promise<SetupItem[]> {
  const out: SetupItem[] = [];
  const where = { label: "Admin Tools, Roles & Permissions", path: "/admin/admin-tools/users-roles" };
  // D2 (docs/plans/DIRECTOR_AUTHORITY.md §4.6): payroll is the two directors'. Each one is told of the other's acts, and sets the other's pay.
  const directors = await activeDirectors();
  const pairOk = directors.length >= 2;
  out.push({ id: "safety:two-people", section: "safety", title: "At least two active directors", why: "Payroll belongs to the two directors. Each is told what the other does on their own authority, and each sets the other's pay, so nobody ever sets their own. With only one, none of that can work.", required: true, status: pairOk ? "CONFIRMED" : "NOT_SET", enteredBy: null, confirmedBy: null, detail: pairOk ? `${directors.length} directors are active.` : `${directors.length} active ${directors.length === 1 ? "director" : "directors"}. Appoint the second director (Super Admin) in Employee profile, Access.`, where });

  // The choice for each payroll step, with no default: "a different director must decide" or "the acting director decides alone, the other is told". One director sets it, the other
  // confirms it. Until both have, payroll refuses to run that step, so each Not set (or waiting) is a blocker.
  const choiceNames = await namesOfUsers((await choiceFacts()).flatMap((c) => (c.confirmedBy ? [c.confirmedBy] : [])));
  for (const c of await choiceFacts()) {
    const label = `${c.label}: who decides`;
    const base = { id: `safety:director-choice:${c.step}`, section: "safety" as const, title: c.demo ? `${label} (DEMO choice)` : label, why: "The two directors choose, with no default, whether a different director must decide this step or the acting director decides alone (the other is told either way). One sets it; the other confirms it. Payroll will not run this step until both have.", required: true, enteredBy: null, where: { label: "Admin Tools, System Settings, Director authority", path: "/admin/admin-tools/settings?section=director" } };
    out.push(
      c.status === "CONFIRMED"
        ? { ...base, status: "CONFIRMED", confirmedBy: c.confirmedBy ? { name: choiceNames.get(c.confirmedBy) ?? "A director", at: c.confirmedAt ?? "" } : null, detail: c.demo ? "A made-up choice, for the DEMO company only." : "Chosen by one director and confirmed by the other." }
        : { ...base, status: c.status === "PENDING_CONFIRMATION" ? "PLACEHOLDER" : "NOT_SET", confirmedBy: null, detail: c.status === "PENDING_CONFIRMATION" ? "Proposed. The other director has not confirmed it yet." : "Not set. Neither director has chosen yet." },
    );
  }

  // Every Super Admin, and anyone who somehow holds a payroll key: two-step sign-in is required of all of them, and the demo exemption never applies where it is enforced.
  const payrollHolders = new Map<string, true>(directors.map((d) => [d.userId, true] as const));
  for (const key of ["payroll.run", "payroll.approve", "payroll.identifiers.manage", "payroll.banklayout.manage", "payroll.salary.edit"]) for (const h of await activeUsersHoldingPermission(key)) payrollHolders.set(h.userId, true);
  const holders = await prisma.user.findMany({ where: { id: { in: [...payrollHolders.keys()] } }, select: { id: true, totpEnabled: true } });
  const without = holders.filter((u) => !u.totpEnabled);
  const noTwoFactor = await namesOfUsers(without.map((u) => u.id));
  const exempt = demo && !twoFactorEnforced();
  const twoFactorOk = exempt || without.length === 0;
  out.push({ id: "safety:two-factor", section: "safety", title: "Every director uses two-step sign-in", why: "These people can move money and see everyone's pay. A password alone is not enough.", required: true, status: twoFactorOk ? "CONFIRMED" : "NOT_SET", enteredBy: null, confirmedBy: null, detail: exempt ? "Not enforced in the demo company." : without.length === 0 ? `All ${holders.length} have it on.` : `${without.length} do not have it on yet: ${[...noTwoFactor.values()].join(", ")}.`, where });

  const real = env.APP_ENV === "production" || env.APP_ENV === "staging";
  const mailOk = !real || env.MAIL_DRIVER === "ses" || env.MAIL_DRIVER === "smtp";
  out.push({ id: "safety:mail", section: "safety", title: "Email goes to real inboxes", why: "Payslip notifications and invitations are emailed. In development they are only written to a file.", required: true, status: mailOk ? "CONFIRMED" : "NOT_SET", enteredBy: null, confirmedBy: null, detail: real ? (mailOk ? `Email is sent through ${env.MAIL_DRIVER}.` : "Email is only being written to a file.") : "Not checked here: this is a development machine.", where: { label: "Deployment settings", path: "/admin/admin-tools/settings" } });

  // Nobody who builds the system can see the owners' secrets. Checked from what is stored, so a configuration mistake shows even though the system strips the access anyway.
  const developers = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: DEVELOPER_ROLE_CODE } } } }, select: { id: true, roles: { select: { role: { select: { code: true, permissions: { select: { permission: { select: { key: true } } } } } } } }, permissionOverrides: { where: { effect: "GRANT" }, select: { permission: { select: { key: true } } } } } });
  const names = await namesOfUsers(developers.map((d) => d.id));
  const sensitive = new Set<string>(SENSITIVE_PERMISSION_KEYS);
  const problems: string[] = [];
  for (const d of developers) {
    const configured = new Set<string>();
    for (const r of d.roles) for (const p of r.role.permissions) if (sensitive.has(p.permission.key)) configured.add(p.permission.key);
    for (const o of d.permissionOverrides) if (sensitive.has(o.permission.key)) configured.add(o.permission.key);
    if (d.roles.some((r) => r.role.code === "SUPER_ADMIN")) configured.add("Super Admin");
    const effective = await resolveAccess(d.id);
    const leaked = [...effective.permissions].filter((k) => sensitive.has(k));
    if (configured.size || leaked.length) problems.push(`${names.get(d.id) ?? "A developer"} is set up with ${[...configured, ...leaked].join(", ")}`);
  }
  out.push({ id: "safety:developer", section: "safety", title: "The person who built the system cannot see the owners' secrets", why: "Salaries, bank accounts, the debit account, the company's registration numbers and the bank layout are for the owners. The developer role is cut off from all of them in code.", required: true, status: problems.length === 0 ? "CONFIRMED" : "NOT_SET", enteredBy: null, confirmedBy: null, detail: problems.length === 0 ? (developers.length === 0 ? "No developer account exists." : `${developers.length} developer account${developers.length === 1 ? "" : "s"}, none able to see or change any of them.`) : problems.join("; "), ...(problems.length ? { problem: "A developer account is configured with access it must never have. The system strips it, but fix the configuration." } : {}), where });
  return out;
}

export async function buildSetupReport(): Promise<SetupReport> {
  const demo = await isDemoCompany();
  const ruleData = await loadItems("RULE");
  const summaries = RULE_CATALOG.map((d) => summarise(ruleData, d.key));
  const plain = new Map<string, unknown>(RULE_CATALOG.map((d, i) => [d.key, d.sensitiveClass ? undefined : summaries[i]!.current?.value]));
  const items: SetupItem[] = [...ruleItems(summaries, plain), ...(await salaryItems()), ...(await layoutItems()), ...(await peopleItems()), ...(await safetyItems(demo))];
  const sections: SetupSection[] = SECTION_ORDER.map((id) => ({ id, ...SECTION_TEXT[id], items: items.filter((i) => i.section === id) }));
  return { generatedAt: new Date().toISOString() /* allow-clock: the instant the report was made */, environment: env.APP_ENV, demo, sections };
}

/** What is missing before the first real run, from the same report. Red until every required item is Confirmed and nothing is wrong. */
export function readinessOf(report: SetupReport): Readiness {
  const blockers: Blocker[] = [];
  let required = 0;
  let confirmed = 0;
  const notRequiredYet: Readiness["notRequiredYet"] = [];
  for (const section of report.sections) {
    for (const item of section.items) {
      if (!item.required) {
        if (item.status !== "CONFIRMED") notRequiredYet.push({ itemId: item.id, title: item.title, status: item.status, reason: item.notRequiredReason ?? "Not needed for the first run." });
        continue;
      }
      required += 1;
      if (item.status === "CONFIRMED" && !item.problem) {
        confirmed += 1;
        continue;
      }
      blockers.push({
        itemId: item.id,
        section: item.section,
        sectionTitle: section.title,
        title: item.title,
        status: item.status,
        missing: item.problem ?? (item.status === "NOT_SET" ? `Not entered yet. ${item.detail}` : item.detail),
        where: item.where,
      });
    }
  }
  return { ready: blockers.length === 0, demo: report.demo, generatedAt: report.generatedAt, required, confirmed, blockers, notRequiredYet };
}
