import { z } from "zod";

// config.json on the office PC (docs/plans/PHASE_2.md §7.1, "P2-F build
// design"). It holds NO secrets: the agent key and each device's comm key live
// in Windows Credential Manager (F2), or in environment variables on Linux
// (development and CI).

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const deviceConfigSchema = z.object({
  /** The serial registered on the Devices screen. The agent checks the device itself reports it before reading. */
  serial: z.string().trim().min(1).max(64),
  /** The device's LAN address (ours: 192.168.29.213, static). */
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(4370),
  transport: z.enum(["auto", "tcp", "udp"]).default("auto"),
  /** "simulated" only for a device the server marks as simulated (P2-F rule 3). */
  driver: z.enum(["zk4370", "simulated"]).default("zk4370"),
  /** Simulated driver only: the JSON file the punch simulator writes the device's log to (P2-G). */
  simulatedStateFile: z.string().optional(),
});

export const agentConfigSchema = z
  .object({
    /** The API's base URL, e.g. https://api.example.com. HTTPS is required except for localhost (P2-F rule 4). */
    apiUrl: z
      .string()
      .trim()
      .url()
      .refine((u) => {
        const url = new URL(u);
        return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
      }, "Use https:// — plain http is allowed only for localhost (development)."),
    pollSeconds: z.number().int().min(5).max(3600).default(30),
    /** Where the agent keeps its state, outbox and nothing else. */
    dataDir: z.string().min(1).optional(),
    /** Where the agent key and comm keys come from. Default: Credential Manager on Windows, environment variables elsewhere. */
    secrets: z.enum(["credential-manager", "env"]).optional(),
    requestTimeoutSeconds: z.number().int().min(5).max(300).default(30),
    deviceTimeoutSeconds: z.number().int().min(2).max(120).default(10),
    backoff: z.object({ initialSeconds: z.number().min(1).max(600).default(5), maxSeconds: z.number().min(5).max(3600).default(300) }).default({ initialSeconds: 5, maxSeconds: 300 }),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    devices: z.array(deviceConfigSchema).min(1, "Configure at least one device."),
  })
  .refine((c) => new Set(c.devices.map((d) => d.serial)).size === c.devices.length, { message: "Each device serial may appear once.", path: ["devices"] });

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type DeviceConfig = z.infer<typeof deviceConfigSchema>;
