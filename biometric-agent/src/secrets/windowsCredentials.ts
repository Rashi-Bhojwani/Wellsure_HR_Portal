import { spawn } from "node:child_process";
import path from "node:path";
import type { SecretStore } from "./index";

// Windows Credential Manager (D-F4): the agent key and each device's comm key
// live in the service account's own vault, reached through Windows PowerShell
// and the system's CredRead / CredWrite — nothing native to build or ship.
// docs/plans/PHASE_2.md "P2-F, commit F2 build design".
//
// The target and the secret never go into the script text or a command line:
// they travel in environment variables of the short-lived PowerShell child.

export const AGENT_KEY_TARGET = "WellsureAgent/agent-key";
export const commKeyTarget = (serial: string) => `WellsureAgent/commkey/${serial}`;

export interface PowerShellResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs a PowerShell script with extra environment variables. Injectable so the logic is testable off Windows. */
export type PowerShellRunner = (script: string, env: Record<string, string>) => Promise<PowerShellResult>;

const NOT_FOUND = 2;

const CRED_TYPE = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WellsureCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredReadW(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredWriteW(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredDeleteW(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr buffer);
  public static int Read(string target, out string secret) {
    secret = null; IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return Marshal.GetLastWin32Error();
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      secret = c.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(c.CredentialBlob, (int)(c.CredentialBlobSize / 2));
      return 0;
    } finally { CredFree(p); }
  }
  public static int Write(string target, string secret) {
    byte[] blob = Encoding.Unicode.GetBytes(secret);
    IntPtr mem = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, mem, blob.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = 1; c.TargetName = target; c.UserName = "WellsureAgent"; c.Persist = 2;
      c.CredentialBlobSize = (UInt32)blob.Length; c.CredentialBlob = mem;
      return CredWriteW(ref c, 0) ? 0 : Marshal.GetLastWin32Error();
    } finally { Marshal.FreeHGlobal(mem); }
  }
  public static int Delete(string target) { return CredDeleteW(target, 1, 0) ? 0 : Marshal.GetLastWin32Error(); }
}
'@
$ErrorActionPreference = 'Stop'
$target = $env:WELLSURE_CRED_TARGET
`;

// ERROR_NOT_FOUND is 1168; everything else is a real failure worth showing.
export const READ_SCRIPT = `${CRED_TYPE}
$secret = $null
$rc = [WellsureCred]::Read($target, [ref]$secret)
if ($rc -eq 1168) { exit ${NOT_FOUND} }
if ($rc -ne 0) { [Console]::Error.WriteLine("CredRead failed: Win32 error $rc"); exit 1 }
[Console]::Out.Write($secret)
exit 0
`;

export const WRITE_SCRIPT = `${CRED_TYPE}
$rc = [WellsureCred]::Write($target, $env:WELLSURE_CRED_VALUE)
if ($rc -ne 0) { [Console]::Error.WriteLine("CredWrite failed: Win32 error $rc"); exit 1 }
exit 0
`;

/** The real runner: Windows PowerShell 5.1 by its full path (not whatever is first on PATH). */
export const windowsPowerShell: PowerShellRunner = (script, env) =>
  new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export const COMM_KEY_CACHE_MS = 10 * 60_000;

export class WindowsCredentialStore implements SecretStore {
  private readonly commKeys = new Map<string, { value: number | null; at: number }>();

  constructor(
    private readonly run: PowerShellRunner = windowsPowerShell,
    private readonly now: () => number = Date.now,
  ) {}

  private async read(target: string): Promise<string | null> {
    const res = await this.run(READ_SCRIPT, { WELLSURE_CRED_TARGET: target });
    if (res.code === NOT_FOUND) return null;
    if (res.code !== 0) throw new Error(`Could not read "${target}" from Windows Credential Manager: ${res.stderr.trim() || `PowerShell exited ${res.code}`}`);
    return res.stdout.trim();
  }

  private async write(target: string, value: string): Promise<void> {
    const res = await this.run(WRITE_SCRIPT, { WELLSURE_CRED_TARGET: target, WELLSURE_CRED_VALUE: value });
    if (res.code !== 0) throw new Error(`Could not store "${target}" in Windows Credential Manager: ${res.stderr.trim() || `PowerShell exited ${res.code}`}`);
  }

  /** Not cached: the agent asks again after a 401, so a rotated key works without a restart. */
  async agentKey(): Promise<string | null> {
    return (await this.read(AGENT_KEY_TARGET)) || null;
  }

  /** Asked every cycle, so cached for a few minutes (a PowerShell start each cycle would be wasteful). */
  async commKey(serial: string): Promise<number | null> {
    const hit = this.commKeys.get(serial);
    if (hit && this.now() - hit.at < COMM_KEY_CACHE_MS) return hit.value;
    const raw = await this.read(commKeyTarget(serial));
    let value: number | null = null;
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new Error(`The comm key stored for ${serial} must be a whole number.`);
      value = n;
    }
    this.commKeys.set(serial, { value, at: this.now() });
    return value;
  }

  async setAgentKey(value: string): Promise<void> {
    await this.write(AGENT_KEY_TARGET, value);
  }

  async setCommKey(serial: string, value: string): Promise<void> {
    if (!/^\d{1,9}$/.test(value)) throw new Error("A comm key is a whole number of up to 9 digits.");
    await this.write(commKeyTarget(serial), value);
    this.commKeys.delete(serial);
  }
}
