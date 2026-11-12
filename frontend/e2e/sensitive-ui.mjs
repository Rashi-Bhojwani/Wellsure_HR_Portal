// The browser half of the sensitive-data scan (docs/plans/PHASE_6.md §14J). Signed in as the developer and as an ordinary employee, on a stack that holds the demo company, it opens every
// page of both portals and checks what a person would SEE and what a screenshot would CONTAIN:
//   - none of the demo company's secrets is anywhere in the page: a bank account, a PAN, a UAN, the debit account, a company identifier, the bank layout's text;
//   - the DEMO COMPANY banner is on the page, so a screenshot of it cannot be taken for the real thing.
// Run against a running stack that has had `npm run seed:demo-company` (backend/):
//
//   npm run check:sensitive-ui         (from frontend/; needs the API, the worker and `npm run dev` up, and Chrome)
//
// SENSITIVE_UI_SCOPE=admin | employee | all (the default) chooses which portal's pages are opened. CI runs the two as separate jobs, each with a limit that leaves a wide margin;
// together they open exactly the pages the one scan used to, each page by each person once.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const OUT = process.env.POPOVER_OUT ?? path.join(here, "out");
mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/google-chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));

// What must never be on a page. The demo company's secrets follow fixed patterns: accounts begin 9999, PANs DEMOX, UANs 99990000, the debit account is 999900000000.
const SECRETS = [
  { label: "a bank account number", re: /\b9999\d{8}\b/ },
  { label: "a PAN", re: /\bDEMOX\d{4}Z\b/ },
  { label: "a UAN", re: /\b99990000\d{4}\b/ },
  { label: "the debit account", re: /\b999900000000\b/ },
  { label: "a company identifier", re: /DEMO\/PF\/00001|DEMO-ESI-00001|DEMO-PT-00001|DEMO-LWF-00001|DEMOT00001D/ },
  { label: "the bank layout's text", re: /DEMO BANK BULK TRANSFER/ },
];

// The pages: every menu path in the two menu configurations (the item paths, in the source, are the routes).
function pathsOf(file) {
  const src = readFileSync(path.resolve(here, "../src/routes", file), "utf8");
  return [...src.matchAll(/\{\s*key: "[^"]+",\s*label: "[^"]+",\s*path: "([^"]+)"/g)].map((m) => m[1]);
}
const unique = (list) => [...new Set(list)]; // a path listed twice is opened once
const adminPaths = unique(pathsOf("adminMenu.config.tsx"));
const employeePaths = unique(pathsOf("employeeMenu.config.tsx"));
const SCOPE = process.env.SENSITIVE_UI_SCOPE ?? "all";
if (!["admin", "employee", "all"].includes(SCOPE)) throw new Error(`SENSITIVE_UI_SCOPE must be admin, employee or all, not "${SCOPE}"`);
const doAdmin = SCOPE !== "employee";
const doEmployee = SCOPE !== "admin";

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
const problems = [];
let pages = 0;

// One sign-in per person, kept for every visit that person makes (the login is rate-limited to ten a quarter of an hour, and the HR Admin is now visited in four states).
const sessions = new Map();
async function sessionFor(user) {
  if (sessions.has(user)) return sessions.get(user);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("e.g. 1042").fill(user);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
  sessions.set(user, page);
  return page;
}

// PEEPS-BEGIN page-checks
// The Peeps checks run on every page of every pass, inside visit(), so they add no page loads of their own (the scan has a time limit). The demo data:
// backend/src/modules/assets/demoSeed.ts issues DEMO-ASSET-HELD-BY-007 to DEMO007; backend/src/modules/peeps/demoSeed.ts makes DEMO008 a Wellsure Office
// member and Unmute host and has DEMO006 book a time with them; backend/src/modules/recognition/demoSeed.ts has a director
// (DEMO001) give DEMO006 a badge and send them a nudge carrying DEMO-NUDGE-PRIVATE (Q-16: only the directors give and send).
const PRIVATE_NUDGE_SEERS = new Set(["DEMO006", "DEMO001"]); // the recipient and the director
const ASSET_MARKER = "DEMO-ASSET-HELD-BY-007";
const ASSET_MONEY = /₹|\bINR\b|\bRs\.?\s?\d/;
async function peepsPageChecks(page, user, label, base, p, text) {
  const where = `${label} on ${base}/${p}`;
  // PEEPS-BEGIN recruitment
  if (!["DEMO001", "DEMO013", "DEMO011"].includes(user) && text.includes("DEMO-C4-PRIVATE-FEEDBACK")) problems.push(`${where}: recruitment feedback outside the submitted panel`);
  if ((p === "recruitment" || p.startsWith("recruitment/")) && user === "DEMO005" && text.includes("DEMO-C4-CANDIDATE")) problems.push(`${where}: Developer sees candidate data`);
  // PEEPS-END recruitment
  // PEEPS-BEGIN recruitment-offers
  // C-4B (backend/src/modules/recruitment/offersDemoSeed.ts): DEMO offer pay 7777123.45 and DEMO expected pay 6666123.45 are directors-only and load
  // only on an explicit "Show pay"; no other person's page may ever contain them, and no recruitment page may show a joiner-link token or storage key.
  if (!["DEMO001", "DEMO013"].includes(user) && /7777123|6666123|7,777,123|66,66,123|77,77,123|6,666,123/.test(text)) problems.push(`${where}: offer pay or expected pay outside the directors`);
  if (text.includes("recruitment/joining/")) problems.push(`${where}: a joining document's storage key is on the page`);
  if ((p === "recruitment" || p.startsWith("recruitment/")) && user === "DEMO005" && text.includes("DEMO-C4B-JOINER")) problems.push(`${where}: Developer sees joiner data`);
  // PEEPS-END recruitment-offers
  // PEEPS-BEGIN exits
  if (!["DEMO001", "DEMO013", "DEMO006", "DEMO004"].includes(user) && text.includes("DEMO-C3-PRIVATE-INTERVIEW")) problems.push(`${where}: sees a private exit interview outside the relationship`);
  if ((p === "exits" || p.startsWith("exits/")) && /₹|\bINR\b|\bRs\.?\s?\d/.test(text)) problems.push(`${where}: exit screen contains a money value`);
  // PEEPS-END exits
  // PEEPS-BEGIN helpdesk-visibility
  if (!["DEMO001", "DEMO013", "DEMO006"].includes(user) && text.includes("DEMO-C2-PRIVATE")) problems.push(`${where}: sees a ticket outside the category audience`);
  if (user !== "DEMO001" && user !== "DEMO013" && text.includes('data-testid="helpdesk-category-visibility"')) problems.push(`${where}: the director-only visibility panel is rendered`);
  // PEEPS-END helpdesk-visibility
  // Private nudges (D-28, D-29): nobody but the recipient and the directors ever sees the text, on any page of either portal.
  if (!PRIVATE_NUDGE_SEERS.has(user) && text.includes("DEMO-NUDGE-PRIVATE")) problems.push(`${where}: sees someone else's private nudge`);
  // The asset register: no asset screen ever shows an amount (the module records events, never money), and who holds what is not shown to another
  // employee or the developer.
  if ((base === "/app" && p === "my-assets") || (base === "/admin" && p.startsWith("assets/"))) {
    if (ASSET_MONEY.test(text)) problems.push(`${where}: an amount is shown on an asset screen`);
    if ((user === "DEMO006" || user === "DEMO005" || user === "DEMO009") && text.includes(ASSET_MARKER)) problems.push(`${where}: sees an asset held by someone else`);
  }
  // New leave types (backend/src/modules/leaveRules/demoSeed.ts): DEMO006's medical leave carries DEMO-LEAVE-REASON-PRIVATE in its reason, which only
  // DEMO006, HR and the directors may see; a supporting document's storage key never reaches any page; team calendars show "Leave", not the type.
  if (!["DEMO006", "DEMO004", "DEMO001"].includes(user) && text.includes("DEMO-LEAVE-REASON-PRIVATE")) problems.push(`${where}: sees someone else's leave reason`);
  if (text.includes("leave-documents/")) problems.push(`${where}: a supporting document's storage key is on the page`);
  if (user !== "DEMO001" && user !== "DEMO004" && /(^|\/)leave\/calendar$/.test(p) && /Medical Leave|\bMEDICAL\b/.test(text)) problems.push(`${where}: the team calendar names a new leave type`);
  // Avatars and directory: the directory never shows a personal email, and the demo leaves the directors' contact-field setting Not set, so no phone either.
  if (base === "/app" && p === "people" && (text.includes("@demo.example.invalid") || text.includes("0000000000"))) problems.push(`${where}: the directory shows a personal email or a phone number`);
  if (base !== "/app" || user === "DEMO001") return;
  // Unmute (D-29, D-30): DEMO006's booking is never shown to anyone else on their Unmute page or on any Wellsure Office page, nor to DEMO006 on a
  // workspace page other than their own booking's.
  const officePage = p.startsWith("office/");
  if (user !== "DEMO006" && (p === "unmute" || officePage) && /DEMO006/.test(text)) problems.push(`${where}: sees someone else's Unmute booking`);
  if (user === "DEMO006" && officePage && p !== "office/unmute" && /DEMO006/.test(text)) problems.push(`${where}: sees an Unmute booking from a Wellsure Office page`);
  // The workspace menu is offered to nobody but members and directors (none of the people crawled here is a member).
  if (p === "home") {
    const nav = await page.evaluate(() => [...document.querySelectorAll("nav, aside")].map((n) => n.textContent ?? "").join(" "));
    if (/Wellsure Office/.test(nav)) problems.push(`${label}: the Wellsure Office workspace is offered in the menu`);
  }
}
// PEEPS-END
async function visit(user, label, base, paths) {
  const page = await sessionFor(user);
  for (const p of paths) {
    const url = `${BASE}${base}/${p}`; if (process.env.SENSITIVE_UI_VERBOSE) console.log("visit", label, url);
    // A navigation can be aborted when the previous page was still redirecting (a menu path that sends you on); it is tried again, never skipped.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.goto(url);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await page.waitForTimeout(800);
      }
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(600);
    pages += 1;
    const text = await page.evaluate(() => document.body.innerText + "\n" + document.body.innerHTML);
    for (const s of SECRETS) if (s.re.test(text)) problems.push(`${label} on ${base}/${p}: the page shows ${s.label}`);
    if (!(await page.getByTestId("demo-company-banner").first().isVisible().catch(() => false))) problems.push(`${label} on ${base}/${p}: the DEMO COMPANY banner is not on the page`);
    // PEEPS-BEGIN page-checks-call
    await peepsPageChecks(page, user, label, base, p, text);
    // PEEPS-END
  }
  await page.screenshot({ path: path.join(OUT, `sensitive-ui-${label.replace(/\W+/g, "-")}.png`) });
}

if (doAdmin) await visit("DEMO005", "the developer", "/admin", adminPaths);
if (doEmployee) await visit("DEMO005", "the developer (own portal)", "/app", employeePaths);
if (doEmployee) await visit("DEMO006", "an ordinary employee", "/app", employeePaths);
// Added with the master build (Stage 0.2): the people who are allowed to see most of the system must not see the demo's secrets on a page either: pay details are masked
// by default and shown only through an audited Reveal, never printed on a page.
if (doAdmin) await visit("DEMO004", "an HR Admin", "/admin", adminPaths);
if (doEmployee) await visit("DEMO004", "an HR Admin (own portal)", "/app", employeePaths);
// Stage 1.6: the same HR Admin with every switch the directors have turned all the way ON (the most HR can ever be given) and then all the way OFF (every duty closed), set through the
// real API by the demo's director and put back as they were. No switch may show a secret, and every page must still say it is the demo.
const API = process.env.API_URL ?? "http://localhost:4000";
// PEEPS-BEGIN exits
const CAPABILITIES = ["VIEW_ATTENDANCE", "APPROVE_REGULARIZATIONS", "APPROVE_LEAVE", "EDIT_MUSTER", "UPLOAD_MANUAL_MUSTER", "FINALISE_MONTH", "CORRECTIONS", "SHIFT_ROSTER", "EXCEPTIONS_QUEUE", "ATTENDANCE_REPORTS", "LEAVE_REPORTS", "MANAGE_EXITS",
  // PEEPS-BEGIN recruitment
  "MANAGE_RECRUITMENT",
  // PEEPS-END recruitment
  // PEEPS-BEGIN recruitment-offers
  "RUN_ONBOARDING",
  // PEEPS-END recruitment-offers
];
// PEEPS-END exits
let directorToken;
async function setAllDuties(state) {
  if (!directorToken) {
  const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeCode: "DEMO001", password: PASSWORD }) });
  directorToken = (await login.json()).accessToken;
  }
  const token = directorToken;
  if (!token) throw new Error("could not sign in as the demo director to set the HR switches");
  for (const roleCode of ["HR_ADMIN", "HR_EXECUTIVE"]) {
    for (const capability of CAPABILITIES) {
      const res = await fetch(`${API}/api/hr-capabilities`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ capability, subject: { kind: "ROLE", roleCode }, state, reason: "the sensitive-data scan" }) });
      if (!res.ok) throw new Error(`could not set ${capability} for ${roleCode} to ${state}: ${res.status}`);
    }
  }
}
try {
  if (doAdmin) {
  await setAllDuties("ON");
  await visit("DEMO004", "an HR Admin (every duty on)", "/admin", adminPaths);
  await setAllDuties("OFF");
  await visit("DEMO004", "an HR Admin (every duty off)", "/admin", adminPaths);
  }
} finally {
  if (doAdmin) await setAllDuties("DEFAULT");
}
if (doAdmin) await visit("DEMO001", "a director", "/admin", adminPaths);
if (doEmployee) await visit("DEMO001", "a director (own portal)", "/app", employeePaths);
// PEEPS-BEGIN peeps-pages
// The Peeps checks themselves run inside visit() on every page above (see peepsPageChecks). Here: one more employee, who is in none of the demo's Peeps
// data, through every employee page; then the pages where the right person must see the demo data, so each check is known to be looking at real data.
if (doEmployee) await visit("DEMO009", "another employee", "/app", employeePaths);
{
  const textOf = async (page, url) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(600);
    pages += 1;
    return page.evaluate(() => document.body.innerText + "\n" + document.body.innerHTML);
  };
  const director = await sessionFor("DEMO001");
  const booker = await sessionFor("DEMO006");
  // The admin-portal half (CI runs the scan as two jobs, SENSITIVE_UI_SCOPE admin / employee).
  if (doAdmin) {
  // Q-14 (2026-11): the register is HR's and the directors'; both must list the demo's issued asset.
  if (!(await textOf(director, `${BASE}/admin/assets/register`)).includes(ASSET_MARKER)) problems.push("the director's asset register does not list the demo's issued asset (is the demo company seeded with assets?)");
  if (!(await textOf(await sessionFor("DEMO004"), `${BASE}/admin/assets/register`)).includes(ASSET_MARKER)) problems.push("the HR Admin's asset register does not list the demo's issued asset");
  // The new leave types: HR's Employee Leave queue shows DEMO006's reason (so the reason check above is looking at real data).
  if (!(await textOf(await sessionFor("DEMO004"), `${BASE}/admin/workforce/leave/employee-leave`)).includes("DEMO-LEAVE-REASON-PRIVATE")) problems.push("the HR Admin's Employee Leave queue does not show the demo's medical leave (is the demo seeded?)");
  }
  // The employee-portal half.
  if (doEmployee) {
  // D-35: My profile and its Change avatar dialog show only the person's own details (no secret, nobody else's contact details or private data).
  {
    const me = await sessionFor("DEMO009");
    await me.goto(`${BASE}/app/my-profile`);
    await me.waitForLoadState("networkidle").catch(() => undefined);
    await me.getByRole("button", { name: /Change avatar/ }).first().click();
    await me.waitForTimeout(900);
    pages += 1;
    const text = await me.evaluate(() => document.body.innerText + "\n" + document.body.innerHTML);
    for (const s of SECRETS) if (s.re.test(text)) problems.push(`DEMO009 on /app/my-profile (Change avatar open): the page shows ${s.label}`);
    if (/demo0(0[1-8]|1[0-3])@demo\.example\.invalid|DEMO-NUDGE-PRIVATE|DEMO-LEAVE-REASON-PRIVATE/.test(text)) problems.push("DEMO009 on /app/my-profile: someone else's details or private data are on the page");
    if (!/Characters/.test(text) || !/Fun picks/.test(text)) problems.push("DEMO009 on /app/my-profile: the Change avatar dialog did not open with its two grids");
    await me.keyboard.press("Escape");
  }
  // DEMO006 sees the Unmute host only as the Wellsure Office, never by name or code; the director's Unmute page shows the booking.
  const own = await textOf(booker, `${BASE}/app/unmute`);
  if (/DEMO008|Demo Employee 008/.test(own)) problems.push("DEMO006 on /app/unmute: the host is shown by name instead of as the Wellsure Office");
  if (!/Wellsure Office/.test(own)) problems.push("DEMO006 on /app/unmute: the demo booking with the Wellsure Office is not shown (is the demo seeded?)");
  if (!/DEMO006/.test(await textOf(director, `${BASE}/app/office/unmute-admin`))) problems.push("the director's Unmute page does not show the demo booking (is the demo seeded?)");
  // DEMO006 sees their nudge, from the Wellsure Office (never the sender's name); the director's Recognition page shows it.
  const recipient = await textOf(booker, `${BASE}/app/recognition`);
  if (!recipient.includes("DEMO-NUDGE-PRIVATE")) problems.push("DEMO006 on /app/recognition: their demo nudge is not shown (is the demo seeded?)");
  if (/Demo Owner|DEMO001/.test(recipient)) problems.push("DEMO006 on /app/recognition: the sending director is shown by name instead of as the Wellsure Office");
  if (!(await textOf(director, `${BASE}/app/office/recognition`)).includes("DEMO-NUDGE-PRIVATE")) problems.push("the director's Recognition page does not show the demo nudge (is the demo seeded?)");
  }
  // PEEPS-BEGIN helpdesk-visibility
  if (doAdmin) {
    const hrQueue = await textOf(await sessionFor("DEMO004"), `${BASE}/admin/employee/helpdesk`);
    if (!hrQueue.includes("DEMO-C2-HR-VISIBLE") || hrQueue.includes("DEMO-C2-PRIVATE")) problems.push("HR's helpdesk queue does not respect the demo category audiences");
    const directorQueue = await textOf(director, `${BASE}/admin/employee/helpdesk`);
    if (!directorQueue.includes("DEMO-C2-PRIVATE")) problems.push("the director cannot see the private demo ticket");
    await textOf(director, `${BASE}/admin/admin-tools/helpdesk-categories`);
    await director.getByRole("button", { name: "Who can see this", exact: true }).first().click();
    await director.getByTestId("helpdesk-category-visibility").waitFor();
    const visibilityText = await director.evaluate(() => document.body.innerText + "\n" + document.body.innerHTML);
    for (const secret of SECRETS) if (secret.re.test(visibilityText)) problems.push(`the category visibility panel shows ${secret.label}`);
    pages += 1;
    await director.keyboard.press("Escape");
  }
  // PEEPS-END helpdesk-visibility
}
// PEEPS-END
// PEEPS-BEGIN exits
// Dynamic case/interview paths supplement the menu scan in both portals.
{
  const API = process.env.API_URL ?? "http://localhost:4000";
  const login=await fetch(`${API}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employeeCode:"DEMO001",password:PASSWORD})});
  const token=(await login.json()).accessToken;if(!token)throw new Error("could not sign in for exit scan");
  const headers={authorization:`Bearer ${token}`};
  const cases=await (await fetch(`${API}/api/exits/resignations`,{headers})).json();
  const exitCase=cases.items?.find(r=>r.reason.includes("DEMO-C3-RESIGNATION"));
  const interviews=await (await fetch(`${API}/api/exits/interviews`,{headers})).json();
  const interview=interviews.items?.find(i=>i.caseId===exitCase?.caseId);
  if(!exitCase?.caseId||!interview?.id)throw new Error("C-3 DEMO exit/interview missing");
  if(doAdmin)for(const user of ["DEMO005","DEMO004","DEMO001"]){
    await visit(user,`${user} exit case`,"/admin",[`exits/cases/${exitCase.caseId}`,`exits/interviews/${interview.id}`]);
  }
  if(doEmployee)for(const user of ["DEMO005","DEMO006","DEMO007","DEMO009","DEMO004","DEMO001"]){
    await visit(user,`${user} exit relationship`,"/app",[`exits/cases/${exitCase.caseId}`,`exits/interviews/${interview.id}`]);
    const page=await sessionFor(user);const text=await page.locator("body").innerText();
    const allowed=["DEMO006","DEMO004","DEMO001"].includes(user);
    if(allowed!==text.includes("DEMO-C3-PRIVATE-INTERVIEW"))problems.push(`${user}: private interview presence differs from its relationship`);
  }
}
// PEEPS-END exits
// PEEPS-BEGIN recruitment
{
 const API=process.env.API_URL??"http://localhost:4000";
 const login=await fetch(`${API}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({employeeCode:"DEMO001",password:PASSWORD})});
 const token=(await login.json()).accessToken;if(!token)throw new Error("could not sign in for recruitment scan");
 const headers={authorization:`Bearer ${token}`};
 const list=await(await fetch(`${API}/api/recruitment/interviews`,{headers})).json();
 const interview=list.items?.find(i=>i.candidate.name==="DEMO-C4-CANDIDATE");if(!interview)throw new Error("C-4 DEMO interview missing");
 if(doAdmin)for(const user of ["DEMO005","DEMO004","DEMO001"])await visit(user,`${user} recruitment`,"/admin",[`recruitment/jobs/${interview.job.id}`,`recruitment/interviews/${interview.id}`]);
 if(doEmployee)for(const user of ["DEMO005","DEMO004","DEMO009","DEMO011","DEMO007","DEMO001"]){
  await visit(user,`${user} recruitment relationship`,"/app",[`recruitment/interviews/${interview.id}`]);
  const page=await sessionFor(user),text=await page.locator("body").innerText();
  if(["DEMO001","DEMO011"].includes(user)!==text.includes("DEMO-C4-PRIVATE-FEEDBACK"))problems.push(`${user}: recruitment feedback differs from its relationship`);
 }
 // PEEPS-BEGIN recruitment-offers
 // Offers and joining: the director and HR onboarding (default on) see the accepted DEMO offer's non-pay terms; the Developer sees nothing.
 if(doAdmin)for(const user of ["DEMO001","DEMO004","DEMO005"]){
  await visit(user,`${user} offers`,"/admin",["recruitment/offers"]);
  const page=await sessionFor(user),text=await page.locator("body").innerText();
  if(["DEMO001","DEMO004"].includes(user)!==text.includes("DEMO-C4B-JOINER"))problems.push(`${user}: the accepted DEMO offer's visibility differs from the onboarding audience`);
 }
 // PEEPS-END recruitment-offers
}
// PEEPS-END recruitment
for (const page of sessions.values()) await page.context().close();
await browser.close();

if (problems.length) {
  console.log(`\n[${SCOPE}] ${problems.length} problem(s) in ${pages} pages:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(`\n[${SCOPE}] No secret on any of ${pages} pages, and the DEMO COMPANY banner on every one.`);
