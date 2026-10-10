// The agent's log: one JSON object per line on stdout. In F2 NSSM captures
// and rotates it; locally it's just the terminal. Never logs a secret: the
// agent key and comm keys are not passed to it anywhere.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minLevel: LogLevel = "info", write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const at = (level: LogLevel) => (msg: string, fields: LogFields = {}) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/** For tests: keeps every line. */
export function memoryLogger(): Logger & { lines: Array<{ level: LogLevel; msg: string } & LogFields> } {
  const lines: Array<{ level: LogLevel; msg: string } & LogFields> = [];
  const at = (level: LogLevel) => (msg: string, fields: LogFields = {}) => void lines.push({ level, msg, ...fields });
  return { lines, debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}
