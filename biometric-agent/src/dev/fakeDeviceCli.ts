import http from "node:http";
import { readFileSync } from "node:fs";
import { FakeZkDevice, type FakeRecord } from "./zkFakeDevice";

// Development only: a fake ZKTeco/eSSL device on this machine, speaking the
// real protocol on TCP and UDP, so the whole agent route can be run locally
// (GETTING_STARTED.md "Running the sync agent locally"). Never part of the
// agent the office PC runs.
//
//   npm run fake-device --prefix biometric-agent -- --serial SIM-001 --port 4370
//       [--commkey 123456] [--clock-offset 200] [--capacity 100000] [--records seed.json]
//       [--control-port 4380]
//
// Control it while it runs (127.0.0.1 only):
//   curl -X POST localhost:4380/punch -d '{"deviceUserId":"1006"}'          # someone punches now
//   curl -X POST localhost:4380/punch -d '{"deviceUserId":"1006","localTime":"2026-10-09 10:02:11"}'
//   curl -X POST localhost:4380/clock -d '{"offsetSeconds":200}'           # its clock drifts
//   curl -X POST localhost:4380/clear                                      # an admin clears the log
//   curl -X POST localhost:4380/power -d '{"on":false}'                    # it stops answering
//   curl localhost:4380/state

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const records = arg("records") ? (JSON.parse(readFileSync(arg("records")!, "utf8")) as FakeRecord[]) : [];
  const device = new FakeZkDevice({
    serial: arg("serial", "SIM-001")!,
    commKey: Number(arg("commkey", "0")),
    clockOffsetSeconds: Number(arg("clock-offset", "0")),
    logCapacity: Number(arg("capacity", "100000")),
    records,
  });
  const port = Number(arg("port", "4370"));
  const { tcpPort, udpPort } = await device.start({ host: arg("host", "127.0.0.1"), tcpPort: port, udpPort: port });
  const controlPort = Number(arg("control-port", "4380"));
  const say = (msg: string) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

  http
    .createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const json = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (req.method === "POST" && req.url === "/punch") {
          const ok = device.punch(String(json.deviceUserId), (json.localTime as string | undefined) ?? undefined);
          say(`punch ${json.deviceUserId} ${ok ? "recorded" : "REFUSED (log full)"}`);
          return send(ok ? 200 : 409, { ok, records: device.records.length });
        }
        if (req.method === "POST" && req.url === "/clock") {
          device.setClockOffset(Number(json.offsetSeconds ?? 0));
          say(`clock offset ${json.offsetSeconds} s; device clock now ${device.now()}`);
          return send(200, { now: device.now() });
        }
        if (req.method === "POST" && req.url === "/clear") {
          device.clear();
          say("log cleared");
          return send(200, { records: 0 });
        }
        if (req.method === "POST" && req.url === "/power") {
          device.faults.silent = json.on === false;
          say(device.faults.silent ? "stopped answering" : "answering again");
          return send(200, { on: !device.faults.silent });
        }
        if (req.method === "GET" && req.url === "/state") {
          return send(200, { serial: device.opts.serial, now: device.now(), records: device.records.length, last: device.records.slice(-20), commands: device.commands.length, violations: device.violations });
        }
        send(404, { error: "POST /punch | /clock | /clear | /power, GET /state" });
      });
    })
    .listen(controlPort, "127.0.0.1");

  say(`fake device ${device.opts.serial}: protocol on TCP ${tcpPort} and UDP ${udpPort}; control on http://127.0.0.1:${controlPort}`);
  setInterval(() => {
    if (device.violations.length) say(`!! received non-read commands: ${device.violations.join(", ")}`);
  }, 5_000).unref();
}

void main();
