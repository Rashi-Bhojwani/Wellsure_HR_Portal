import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../log";
import { alarmToEventLog, eventForAlarm, EVENT_IDS, EVENT_SOURCE, nullEventLog, WindowsEventLog, createEventLog } from "../eventLog";

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("event log entries", () => {
  it("each alarm change maps to a fixed ID and severity (the IDs are listed in INSTALL.md)", () => {
    expect(eventForAlarm("RETENTION", "warning")).toEqual({ id: 10, level: "WARNING" });
    expect(eventForAlarm("RETENTION", "error")).toEqual({ id: 11, level: "ERROR" });
    expect(eventForAlarm("RETENTION", "recovered")).toEqual({ id: 12, level: "INFORMATION" });
    expect(eventForAlarm("LOG_NEARLY_FULL", "warning")).toEqual({ id: 20, level: "WARNING" });
    expect(eventForAlarm("LOG_NEARLY_FULL", "recovered")).toEqual({ id: 21, level: "INFORMATION" });
    expect(eventForAlarm("CLOCK_DRIFT", "warning")).toEqual({ id: 30, level: "WARNING" });
    expect(eventForAlarm("CLOCK_DRIFT", "recovered")).toEqual({ id: 31, level: "INFORMATION" });
    expect(eventForAlarm("BATCH_SET_ASIDE", "error")).toEqual({ id: 40, level: "ERROR" });
    expect(eventForAlarm("KEY_REJECTED", "error")).toEqual({ id: 50, level: "ERROR" });
    expect(eventForAlarm("KEY_REJECTED", "recovered")).toEqual({ id: 51, level: "INFORMATION" });
    expect(EVENT_IDS.STARTED).toBe(1);
    expect(EVENT_IDS.STOPPED).toBe(2);
    // eventcreate accepts IDs 1–1000 only, and every ID is distinct.
    const ids = Object.values(EVENT_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => i >= 1 && i <= 1000)).toBe(true);
  });

  it("is written with eventcreate, as an argument list (no shell), to the WellsureAgent source", async () => {
    const calls: string[][] = [];
    const log = new WindowsEventLog(memoryLogger(), async (args) => {
      calls.push(args);
      return { code: 0, stderr: "" };
    });
    alarmToEventLog(log)("DEV-1", "CLOCK_DRIFT", "warning", `DEV-1's clock is 3 min ahead & "quoted"; calc.exe`);
    await flush();
    expect(calls).toEqual([["/ID", "30", "/L", "APPLICATION", "/T", "WARNING", "/SO", EVENT_SOURCE, "/D", `DEV-1's clock is 3 min ahead & "quoted"; calc.exe`]]);
  });

  it("a failing event log never stops the agent, and is mentioned once", async () => {
    const logger = memoryLogger();
    const log = new WindowsEventLog(logger, async () => ({ code: 1, stderr: "ERROR: Access is denied." }));
    log.write(1, "INFORMATION", "a");
    log.write(2, "INFORMATION", "b");
    await flush();
    const warns = logger.lines.filter((l) => l.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toMatch(/event log/);
    const thrown = new WindowsEventLog(logger, async () => {
      throw new Error("spawn failed");
    });
    expect(() => thrown.write(1, "INFORMATION", "x")).not.toThrow();
    await flush();
  });

  it("only Windows writes to it", () => {
    expect(createEventLog("linux", memoryLogger())).toBe(nullEventLog);
    expect(createEventLog("win32", memoryLogger())).toBeInstanceOf(WindowsEventLog);
  });
});
