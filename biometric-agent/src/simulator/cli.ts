import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatAttlogLine, instantToLocalTime } from "@shared/attendance/attlog";
import type { Roster } from "@shared/attendance/simulator/model";
import { NAMED_SCENARIOS, planDays } from "@shared/attendance/simulator/month";
import { AgentRoute, FileRoute, PushRoute, type Route } from "./routes";
import { formatReport, runPlan } from "./run";
import { assertDevelopmentServer, RefusedError, ServerApi, ServerError } from "./serverApi";
import { readLocalConfig, setupSimulator, type LocalSimulatorConfig } from "./setup";

// npm run simulate --prefix biometric-agent -- <command> [options]
// docs/plans/PHASE_2.md "P2-G, commit G2 build design". The simulator only ever
// sends punches through the three real routes; it never writes to the database,
// and it refuses to run against anything that looks like production.

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Where the simulator keeps its private files (the agent key, the work folder). SIM_HOME lets a test use a throwaway folder.
const ROOT = process.env.SIM_HOME ?? AGENT_ROOT;
const out = (line = "") => process.stdout.write(`${line}\n`);

const USAGE = `Punch simulator (development only)

  simulate setup                       register the simulator's agent and one simulated device per route
  simulate scenario <name> [options]   one named scenario for some employees on one day
  simulate replay [options]            the planned days for the server's roster over a range
  simulate drip [options]              single punches in real time, to watch the screens update
  simulate fault <kind> [options]      put the simulated device or agent in trouble for a while, then fix it:
                                         device-silent (the device is switched off), agent-silent (the agent stops),
                                         wrong-clock (the device clock is --offset seconds out). --for <seconds>, default 360.
                                         Raises the real alerts (inside the branch's working hours); needs the worker and scheduler.
  simulate scenarios                   list the scenario names

Options
  --route agent|push|file   how the punches reach the server (default agent)
  --api <url>               the server (default $SIM_API_URL or http://localhost:4000)
  --user <code>             who signs in to read the roster ($SIM_USER); the password is read from $SIM_PASSWORD
  --seed <n>                the same seed gives the same punches (default 1)
  --date <YYYY-MM-DD>       scenario: the day (default yesterday)
  --employee <code[,code]>  limit to these employees
  --count <n>               scenario/replay: at most n employees
  --from/--to <YYYY-MM-DD>  replay: the range (default the last 7 days up to yesterday)
  --for <seconds>           fault: how long the trouble lasts (default 360)
  --offset <seconds>        fault wrong-clock: how far out the device clock is (default 600)
  --rate <n>                drip: punches per minute (default 6)
  --verify                  after sending, recompute the range on the server and compare every day with its scenario
  --commit                  file route: upload the file the way HR does (otherwise only write it)
  --allow-remote            allow a server that is not this machine (a staging server). Never production.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const istToday = () => instantToLocalTime(new Date(), "Asia/Kolkata").slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function connect(): Promise<{ api: ServerApi; probe: Awaited<ReturnType<typeof assertDevelopmentServer>> }> {
  const api = new ServerApi(arg("api") ?? process.env.SIM_API_URL ?? "http://localhost:4000");
  const user = arg("user") ?? process.env.SIM_USER;
  const password = process.env.SIM_PASSWORD;
  if (!user || !password) throw new RefusedError("Say who signs in: --user <employee code> (or $SIM_USER) and the password in $SIM_PASSWORD. The password is never taken from the command line.");
  if (!api.isLocal && !flag("allow-remote")) {
    // Before even signing in: do not send credentials to a server that is not this machine.
    throw new RefusedError(`${api.baseUrl} is not this machine. The simulator only runs against a local development server unless you pass --allow-remote (for a staging server). Nothing was sent.`);
  }
  await api.login(user, password);
  const probe = await assertDevelopmentServer(api, { allowRemote: flag("allow-remote"), probeFrom: shift(istToday(), -1), probeTo: shift(istToday(), -1) });
  return { api, probe };
}

function makeRoute(name: string, api: ServerApi, local: LocalSimulatorConfig, workDir: string): Route {
  if (name === "agent") {
    const key = process.env.WELLSURE_AGENT_KEY ?? local.agentKey;
    return new AgentRoute({ apiUrl: api.baseUrl, agentKey: key, serial: local.serials.agent, workDir });
  }
  if (name === "push") return new PushRoute(api, local.serials.push);
  if (name === "file") return new FileRoute({ api: flag("commit") ? api : undefined, deviceId: local.deviceIds.file, writeTo: path.join(workDir, "attlog.txt") });
  throw new RefusedError(`Unknown route "${name}": use agent, push or file.`);
}

function chosenRoster(roster: Roster, codes: string[] | undefined, count: number | undefined): string[] {
  const all = roster.employees.map((e) => e.code);
  const wanted = codes ? all.filter((c) => codes.includes(c)) : all;
  return count ? wanted.slice(0, count) : wanted;
}

async function planned(api: ServerApi, from: string, to: string, seed: number, scenario?: string) {
  const r = await api.roster(from, to, seed);
  const codes = chosenRoster(r.roster, arg("employee")?.split(","), arg("count") ? Number(arg("count")) : undefined);
  if (codes.length === 0) throw new RefusedError(`No employee on this server can be planned for ${from}…${to}. ${r.skipped.length ? `Skipped: ${r.skipped.slice(0, 3).map((s) => `${s.employeeCode} (${s.reason})`).join("; ")}` : "Is anyone mapped to a biometric device user ID?"}`);
  if (r.skipped.length) out(`(${r.skipped.length} employee(s) the simulator cannot plan are skipped, e.g. ${r.skipped[0]!.employeeCode}: ${r.skipped[0]!.reason})`);
  const plan = planDays(r.roster, { scenario, employees: codes });
  if (plan.problems.length) throw new Error(`The simulator's own scenarios disagree with its reference model (a bug in the simulator):\n${plan.problems.slice(0, 5).join("\n")}`);
  return plan;
}

async function sendAndReport(api: ServerApi, route: Route, plan: Awaited<ReturnType<typeof planned>>) {
  try {
    const report = await runPlan({ api, route, plan, verify: flag("verify"), today: istToday(), log: out });
    out(formatReport(report));
    return report.mismatches.length === 0 ? 0 : 1;
  } finally {
    await route.stop();
  }
}

async function main(): Promise<number> {
  const command = process.argv[2];
  if (!command || command === "help" || flag("help")) {
    out(USAGE);
    return command ? 0 : 1;
  }
  if (command === "scenarios") {
    for (const n of NAMED_SCENARIOS) out(n);
    out("(see docs/plans/PHASE_2_SCENARIOS.md for what each one is and what should happen)");
    return 0;
  }
  if (command === "scenario") {
    const name = process.argv[3];
    if (!name || !NAMED_SCENARIOS.includes(name)) throw new RefusedError(`Say which scenario: one of ${NAMED_SCENARIOS.join(", ")}`);
    if (name === "stale-day" || name === "stray-flagged") throw new RefusedError(`${name} needs punches that reach the server late, which needs the server's clock moved. The replay tests cover it; it cannot be sent through a real route.`);
  }
  const { api } = await connect();
  const seed = Number(arg("seed") ?? 1);
  const workDir = path.join(ROOT, ".simulator", "work");

  if (command === "setup") {
    const cfg = await setupSimulator(api, ROOT);
    out(`Registered (or found) the simulator's agent and devices: ${Object.values(cfg.serials).join(", ")}`);
    out("The agent key is kept in biometric-agent/.simulator/local.json (private, not committed).");
    return 0;
  }
  const local = readLocalConfig(ROOT);
  if (!local) throw new RefusedError("Run `simulate setup` first: it registers the simulated devices.");
  const routeName = arg("route") ?? "agent";

  if (command === "fault") {
    const kind = process.argv[3];
    if (kind !== "device-silent" && kind !== "agent-silent" && kind !== "wrong-clock") throw new RefusedError("Say which fault: device-silent, agent-silent or wrong-clock.");
    const route = makeRoute("agent", api, local, workDir) as AgentRoute;
    const seconds = Number(arg("for") ?? 360);
    const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
    await route.start();
    try {
      out("The simulated device and agent are running normally (letting them report in)…");
      await wait(15);
      out(`Fault: ${kind} for ${seconds} s. Watch the Devices screen (Incidents) and the notification bell.`);
      if (kind === "device-silent") route.setReachable(false);
      else if (kind === "wrong-clock") route.setClockOffset(Number(arg("offset") ?? 600));
      else await route.pause();
      await wait(seconds);
      out("Fixing it…");
      if (kind === "device-silent") route.setReachable(true);
      else if (kind === "wrong-clock") route.setClockOffset(0);
      else await route.resume();
      await wait(30);
      out("Done. The recovery notice follows within a couple of minutes of the check seeing it clear.");
    } finally {
      await route.stop();
    }
    return 0;
  }
  if (command === "scenario") {
    const name = process.argv[3]!;
    const date = arg("date") ?? shift(istToday(), -1);
    const plan = await planned(api, date, date, seed, name);
    return sendAndReport(api, makeRoute(routeName, api, local, workDir), plan);
  }
  if (command === "replay") {
    const to = arg("to") ?? shift(istToday(), -1);
    const from = arg("from") ?? shift(to, -6);
    const plan = await planned(api, from, to, seed);
    return sendAndReport(api, makeRoute(routeName, api, local, workDir), plan);
  }
  if (command === "drip") {
    const rate = Number(arg("rate") ?? 6);
    const date = istToday();
    const r = await api.roster(date, date, seed);
    const codes = chosenRoster(r.roster, arg("employee")?.split(","), undefined);
    if (codes.length === 0) throw new RefusedError("Nobody to punch for.");
    const byCode = new Map(r.roster.employees.map((e) => [e.code, e]));
    const route = makeRoute(routeName, api, local, workDir);
    if (route instanceof AgentRoute) await route.start();
    process.once("SIGINT", () => void route.stop().then(() => process.exit(0)));
    out(`Dripping ${rate} punch(es) a minute by the ${routeName} route for ${codes.length} employee(s). Ctrl-C to stop.`);
    for (let i = 0; ; i++) {
      const code = codes[i % codes.length]!;
      const now = instantToLocalTime(new Date(), "Asia/Kolkata");
      const deviceUserId = byCode.get(code)!.deviceUserId;
      await route.send([{ deviceUserId, localTime: now, line: formatAttlogLine({ deviceUserId, localTime: now }) }]);
      out(`${now}  ${code} punched (${routeName})`);
      await new Promise((res) => setTimeout(res, Math.max(1, 60_000 / rate)));
    }
  }
  throw new RefusedError(`Unknown command "${command}".\n\n${USAGE}`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof RefusedError) {
      out(`Not run: ${err.message}`);
      process.exit(2);
    }
    if (err instanceof ServerError) {
      out(`The server answered: ${err.message}${err.status === 429 ? "\n(Signing in is rate-limited; wait a few minutes.)" : ""}`);
      process.exit(1);
    }
    process.stderr.write(`${(err as Error).stack ?? err}\n`);
    process.exit(1);
  },
);
