import http from "node:http";
import { FakeApi, type FakeApiMode } from "../sync/__tests__/fakeApi";

// Development and CI only: a stand-in for the two agent endpoints, so the
// packaged agent (the Windows service on the CI runner, or the executable on
// a laptop) can be run end to end with no real server. Like the real service
// it drops exact duplicate punches. Never part of the agent the office PC runs.
//
//   npm run fake-api --prefix biometric-agent -- --key wsa_test --serial SIM-001 [--port 4400] [--control-port 4401]
//
// Control (127.0.0.1 only):
//   curl localhost:4401/state                              # punches stored, heartbeats seen, last heartbeat
//   curl -X POST localhost:4401/mode -d '{"mode":"down"}'  # ok | down | 500 | 401 | 403 | 400
//   curl -X POST localhost:4401/key  -d '{"key":"wsa_new"}'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const serials = (arg("serial", "SIM-001") ?? "").split(",").filter(Boolean);
  const api = new FakeApi({
    key: arg("key", "wsa_test")!,
    devices: serials.map((serial) => ({ serial, name: `Fake ${serial}`, timezone: "Asia/Kolkata", syncFrom: arg("sync-from", "2020-01-01")!, retentionDays: 3, retentionRecords: 20_000, isSimulated: false })),
  });
  await api.start(Number(arg("port", "4400")));
  const control = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as { mode?: FakeApiMode; key?: string }) : {};
      if (req.method === "POST" && req.url === "/mode" && body.mode) api.mode = body.mode;
      if (req.method === "POST" && req.url === "/key" && body.key) api.key = body.key;
      const last = api.heartbeats.at(-1) ?? null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          mode: api.mode,
          stored: Object.fromEntries(serials.map((s) => [s, api.storedFor(s)])),
          heartbeats: api.heartbeats.length,
          lastHeartbeat: last,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => control.listen(Number(arg("control-port", "4401")), "127.0.0.1", () => resolve()));
  process.stdout.write(`fake API on 127.0.0.1:${arg("port", "4400")} (control ${arg("control-port", "4401")}), key ${arg("key", "wsa_test")}, devices ${serials.join(", ")}\n`);
  const stop = () => void api.stop().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main();
