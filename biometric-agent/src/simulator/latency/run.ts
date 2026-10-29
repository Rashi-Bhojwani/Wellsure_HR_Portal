import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { formatAttlogLine, instantToLocalTime } from "@shared/attendance/attlog";
import { AgentRoute, FileRoute, PushRoute, type PunchLine } from "../routes";
import { assertDevelopmentServer, ServerApi } from "../serverApi";
import { msUntilClearOfMidnight, openTheDay, type AllDay } from "./allDay";
import { setupSimulator } from "../setup";
import { baselineOf, GATE_MS, summarisePerRoute, verdict, type Baseline, type RouteName, type Sample } from "./stats";

// The punch-to-screen latency test (docs/plans/PHASE_2.md "P2-G, commit G2 build
// design", G2b; spec gate G1). The claim this project rests on: a punch shows on
// the screen of the employee who made it and of HR within seconds, with no reload.
// This measures it, in a real browser, for each of the three routes, and fails if
// any sample on any screen is slower than the gate.
//
//   npm run test:latency --prefix biometric-agent
//
// Needs a running API, worker and frontend (see docs/GETTING_STARTED.md). The
// clock that matters is this machine's: the punch's arrival is the server's own
// receipt time (agent) or the moment just before the request / commit (push,
// file), and the screen's change is timestamped inside the page by a
// MutationObserver, so the figure is what a person would see, not what a socket
// delivered.

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = (line = "") => process.stdout.write(`${line}\n`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const WAIT_MS = 20_000; // longer than the gate: a slow sample should be measured, not abandoned

const istToday = () => instantToLocalTime(new Date(), "Asia/Kolkata").slice(0, 10);
const istTimeOfDay = () => instantToLocalTime(new Date(), "Asia/Kolkata").slice(11, 19);

// ── the two screens, watched from inside the page ─────────────────────────
// The code below runs in the browser, so it is plain JavaScript in a string
// (this project's TypeScript has no DOM types, and the agent has no business with them).

/** Installs, in the page, a promise that resolves with Date.now() the moment `condition` first holds; `before` is evaluated once, now. */
const watcherSource = (before: string, condition: string, failure: string): string => `(() => {
  const before = ${before};
  window.__latency = new Promise((resolve, reject) => {
    const holds = () => (${condition});
    const obs = new MutationObserver(() => { if (holds()) { obs.disconnect(); resolve(Date.now()); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { obs.disconnect(); reject(new Error(${JSON.stringify(failure)})); }, ${WAIT_MS});
  });
  return true;
})()`;

/** The employee's day panel lists one more punch from `device` than it did. */
async function watchEmployeePanel(page: Page, device: string): Promise<void> {
  const count = `[...document.querySelectorAll(".ant-list-item")].filter((e) => (e.textContent || "").includes(${JSON.stringify(device)})).length`;
  await page.evaluate(watcherSource(count, `(${count}) > before`, `the punch never appeared in the employee's day panel within ${WAIT_MS} ms`));
}

/** HR's Who Is In?: the person appears under "Arrived", or under "Away" as having worked anyway. */
async function watchWhoIsIn(page: Page, code: string): Promise<void> {
  const present = `(() => {
    const re = new RegExp("(?<![0-9])" + ${JSON.stringify(code)} + " ·");
    const cards = [...document.querySelectorAll(".ant-card")];
    const card = (prefix) => cards.find((c) => ((c.querySelector(".ant-card-head-title") || {}).textContent || "").startsWith(prefix));
    const item = (c) => (c ? [...c.querySelectorAll(".ant-list-item")].find((li) => re.test(li.textContent || "")) : undefined);
    const away = item(card("Away"));
    return !!item(card("Arrived (")) || (!!away && (away.textContent || "").includes("worked anyway"));
  })()`;
  await page.evaluate(watcherSource("null", present, `${code} never appeared on Who Is In? within ${WAIT_MS} ms`));
}

const arrivedAt = (page: Page): Promise<number> => page.evaluate("window.__latency") as Promise<number>;

// ── the run ───────────────────────────────────────────────────────────────

async function signIn(browser: Browser, web: string, code: string, password: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await page.goto(`${web}/login`);
  await page.getByLabel("Employee Code").fill(code);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(app|admin)/, { timeout: 15_000 });
  return page;
}

async function main(): Promise<number> {
  const apiUrl = arg("api") ?? process.env.SIM_API_URL ?? "http://localhost:4000";
  const web = arg("web") ?? process.env.LATENCY_WEB_URL ?? "http://localhost:5173";
  const user = arg("user") ?? process.env.SIM_USER ?? "1000";
  const password = process.env.SIM_PASSWORD;
  if (!password) throw new Error("Set SIM_PASSWORD (the HR account's password) in the environment.");
  const employeePassword = process.env.LATENCY_EMPLOYEE_PASSWORD ?? password;
  // A run of a few minutes must not straddle midnight (the one moment no all-day window covers).
  const hold = msUntilClearOfMidnight(istTimeOfDay());
  if (hold > 0) {
    out(`It is ${istTimeOfDay()} IST: waiting ${Math.round(hold / 1000)} s so the run does not straddle midnight.`);
    await sleep(hold);
  }
  const today = istToday();
  const outFile = arg("out") ?? path.join(AGENT_ROOT, "perf", "latency-last-run.json");
  const baselineFile = path.join(AGENT_ROOT, "perf", "latency-baseline.json");
  const updateBaseline = process.argv.includes("--update-baseline");

  const api = new ServerApi(apiUrl);
  await api.login(user, password);
  await assertDevelopmentServer(api, { allowRemote: process.argv.includes("--allow-remote"), probeFrom: today, probeTo: today });
  const home = mkdtempSync(path.join(os.tmpdir(), "latency-"));
  const cfg = await setupSimulator(api, home, "LAT");

  // People who can be punched for today: employed, on a device, nobody has punched for them yet.
  const roster = (await api.roster(today, today, 1)).roster;
  const working = roster.employees.filter((e) => e.joined <= today && (!e.lastWorking || e.lastWorking >= today) && !e.leaves.some((l) => l.date === today));
  const stored = await api.days(working.map((e) => e.code), today, today);
  const fresh = working.filter((e) => Number(stored[`${e.code}|${today}`]?.punchCount ?? 0) === 0);
  if (fresh.length < 8) throw new Error(`Need at least 8 people with no punches today to measure with; found ${fresh.length}. Use a freshly seeded development database.`);

  // The hour this runs at must not matter: the people measured get an all-day shift for the duration (see allDay.ts).
  const measured = fresh.filter((e) => e.code !== user).slice(0, 12);
  let opened: AllDay | null = null;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const pages: Page[] = [];
  const samples: Sample[] = [];
  let agent: AgentRoute | null = null;
  try {
    opened = await openTheDay(api, today, measured.map((e) => e.code));
    const hr = await signIn(browser, web, user, password);
    pages.push(hr);
    await hr.goto(`${web}/admin/workforce/attendance/who-is-in`);
    // The board's tiles are StatCards since the UI pass (they stopped being antd Statistics, which is what this used to wait for, and the wait timed out from then on).
    await hr.getByText("Not yet arrived").first().waitFor();

    // Only people HR's board actually lists today (it is scoped, and not everyone is expected) can be measured on it.
    await hr.waitForFunction('document.body.innerText.includes(" · ")', undefined, { timeout: 15_000 });
    const listed = new Set(((await hr.evaluate("document.body.innerText")) as string).match(/[0-9]+(?= ·)/g) ?? []);
    const candidates = measured.filter((e) => listed.has(e.code));
    if (candidates.length < 6) throw new Error(`Need at least 6 people on HR's Who Is In? board with no punches today; found ${candidates.length}. Use a freshly seeded development database.`);

    // Three employees watching their own Attendance Info, today's day panel open. Anyone who cannot sign in is passed over.
    const watchers: Array<{ code: string; deviceUserId: string; page: Page }> = [];
    const spare = [...candidates];
    while (watchers.length < 3 && spare.length > 3) {
      const e = spare.shift()!;
      try {
        const page = await signIn(browser, web, e.code, employeePassword);
        await page.goto(`${web}/app/attendance/info`);
        await page.waitForSelector('[role="grid"]');
        const label = await page.evaluate(() => new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", ""));
        await page.locator(`[aria-label^="${label}:"]`).first().click();
        pages.push(page);
        watchers.push({ code: e.code, deviceUserId: e.deviceUserId, page });
      } catch {
        out(`(${e.code} could not be signed in to watch; trying the next person)`);
      }
    }
    if (watchers.length < 3) throw new Error("Could not sign in three employees to watch their own screens (are the seeded accounts active, with the password in LATENCY_EMPLOYEE_PASSWORD?).");
    const bystanders = spare.slice(0, 3);

    agent = new AgentRoute({ apiUrl, agentKey: cfg.agentKey, serial: cfg.serials.agent, workDir: path.join(home, "agent"), pollSeconds: 5 });
    await agent.start();
    await sleep(3000); // the agent's first poll and heartbeat
    const routes = { agent, push: new PushRoute(api, cfg.serials.push), file: new FileRoute({ api, deviceId: cfg.deviceIds.file, reason: "Punch simulator latency test (development)" }) };
    const deviceName: Record<RouteName, string> = { agent: "Simulator device (agent route)", push: "Simulator device (ADMS push route)", file: "Simulator device (file route)" };

    const lineFor = (deviceUserId: string): PunchLine => {
      const localTime = instantToLocalTime(new Date(), "Asia/Kolkata");
      return { deviceUserId, localTime, line: formatAttlogLine({ deviceUserId, localTime }) };
    };

    /** One punch through one route, watching the screens that apply; returns the sample. */
    async function measure(route: RouteName, who: { code: string; deviceUserId: string }, watch: { employee?: Page; board: boolean }): Promise<Sample> {
      if (watch.employee) await watchEmployeePanel(watch.employee, deviceName[route]);
      if (watch.board) await watchWhoIsIn(hr, who.code);
      const line = lineFor(who.deviceUserId);
      let t0: number;
      let punchToServerMs: number | null = null;
      if (route === "agent") {
        const recordedAt = Date.now();
        await routes.agent.send([line]);
        // The server's own receipt time is the start: how long the agent took to find and post it is a different number.
        t0 = await receivedAfter(api, cfg.deviceIds.agent, recordedAt);
        punchToServerMs = t0 - recordedAt;
      } else if (route === "push") {
        t0 = Date.now();
        await routes.push.send([line]);
      } else {
        const batchId = await routes.file.stage([line]);
        t0 = Date.now();
        await routes.file.commit(batchId!);
      }
      const sample: Sample = { route, employee: who.code, employeeScreenMs: null, whoIsInMs: null, punchToServerMs };
      // A screen that never shows the punch is a failure to report, not a crash: it is recorded as the longest wait.
      const took = async (page: Page, what: string) => {
        try {
          return (await arrivedAt(page)) - t0;
        } catch (err) {
          out(`  ✗ ${route} ${who.code}: ${what}: ${(err as Error).message.split("\n")[0]}`);
          return WAIT_MS;
        }
      };
      if (watch.employee) sample.employeeScreenMs = await took(watch.employee, "own screen");
      if (watch.board) sample.whoIsInMs = await took(hr, "Who Is In?");
      out(`  ${route.padEnd(5)} ${who.code}: ${[sample.punchToServerMs !== null ? `device→server ${sample.punchToServerMs} ms` : "", sample.employeeScreenMs !== null ? `own screen ${sample.employeeScreenMs} ms` : "", sample.whoIsInMs !== null ? `Who Is In? ${sample.whoIsInMs} ms` : ""].filter(Boolean).join(", ")}`);
      return sample;
    }

    out(`Punch-to-screen latency, ${today}: three samples per route (gate ${GATE_MS} ms from the punch reaching the server)`);
    const order: RouteName[] = ["push", "file", "agent"];
    for (const [i, route] of order.entries()) {
      const w = watchers[i]!;
      samples.push(await measure(route, w, { employee: w.page, board: true })); // first punch: both screens
      samples.push(await measure(route, bystanders[i]!, { board: true })); // a stranger's: HR's board only
      samples.push(await measure(route, w, { employee: w.page, board: false })); // the employee's second punch: their own screen only
    }

    const summaries = summarisePerRoute(samples);
    const baseline: Baseline | null = existsSync(baselineFile) ? (JSON.parse(readFileSync(baselineFile, "utf8")) as Baseline) : null;
    const problems = verdict(samples, summaries, updateBaseline ? null : baseline);
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify({ day: today, gateMs: GATE_MS, recordedAt: new Date().toISOString(), samples, summaries, problems }, null, 2));
    if (updateBaseline && problems.length === 0) writeFileSync(baselineFile, JSON.stringify({ recordedOn: process.env.LATENCY_BASELINE_MACHINE ?? "unspecified", ...baselineOf(summaries) }, null, 2));

    out();
    for (const r of order) {
      const s = summaries[r];
      out(`${r.padEnd(5)} own screen ${s.employeeScreen ? `${s.employeeScreen.min}/${s.employeeScreen.median}/${s.employeeScreen.max}` : "—"} ms, Who Is In? ${s.whoIsIn ? `${s.whoIsIn.min}/${s.whoIsIn.median}/${s.whoIsIn.max}` : "—"} ms   (min/median/max)`);
    }
    out("(agent: a punch also waits for the agent's next poll; this run polls every 5 s, a production PC every 30 s)");
    if (problems.length) {
      out();
      for (const p of problems) out(`FAIL ${p}`);
      return 1;
    }
    out(`PASS every sample on every screen within ${GATE_MS} ms`);
    return 0;
  } finally {
    await opened?.restore();
    await agent?.stop();
    await browser.close().catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
}

/** The server's own receipt time of the first batch on this device at or after `since`. */
async function receivedAfter(api: ServerApi, deviceId: string, since: number): Promise<number> {
  const until = Date.now() + WAIT_MS * 2;
  while (Date.now() < until) {
    const r = await api.request<{ batches: Array<{ receivedAt: string }> }>("GET", `/api/biometric/batches?deviceId=${deviceId}&limit=5`);
    const t = r.batches.map((b) => Date.parse(b.receivedAt)).filter((x) => x >= since - 50).sort((a, b) => a - b)[0];
    if (t !== undefined) return t;
    await sleep(100);
  }
  throw new Error("The server never received the agent's batch.");
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`);
    process.exit(2);
  },
);
