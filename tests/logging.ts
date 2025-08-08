// Shared test logging control
import logger from "node-color-log";
import fs from "node:fs";

// Detect if tests are invoked with grep (focused run)
const INVOKED_WITH_GREP = process.argv.includes("--grep") || process.argv.includes("-g");

// Exported flag: when running all (no grep), keep logs off for minimal output
export const ENABLE_LOG: boolean = INVOKED_WITH_GREP; // i.e. for a single test

// Simple in-memory buffer for test logs when logging is disabled
const LOG_BUFFER: string[] = [];
type LogEntry = { token: string; line: string };
const LOG_ENTRIES: LogEntry[] = [];
const MAX_BUFFER_LINES = 100000; // generous safety cap to avoid truncation

let ACTIVE_TOKEN: string = "global";
export function setActiveLogToken(token: string): void {
  ACTIVE_TOKEN = token || "global";
}

// Keep references to original console methods so we can dump later
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function pushToBuffer(prefix: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${prefix} ${args.map(stringifyArg).join(" ")}`;
  LOG_BUFFER.push(line);
  LOG_ENTRIES.push({ token: ACTIVE_TOKEN, line });
  const over = Math.max(0, LOG_BUFFER.length - MAX_BUFFER_LINES);
  if (over > 0) {
    LOG_BUFFER.splice(0, over);
    LOG_ENTRIES.splice(0, over);
  }
}

export function clearBufferedLogs(): void {
  LOG_BUFFER.length = 0;
  LOG_ENTRIES.length = 0;
}

export function getBufferedLogs(): string[] {
  return [...LOG_BUFFER];
}

export function dumpBufferedLogs(header?: string): void {
  const lines = getBufferedLogs();
  if (lines.length === 0) return;
  const headerLine = header ? `=== ${header} ===\n` : "";
  const body = lines.join("\n") + "\n";
  // Synchronous, blocking write to avoid interleaving with next test's output
  try {
    const buf = Buffer.from(headerLine + body, "utf8");
    let offset = 0;
    while (offset < buf.length) {
      const written = fs.writeSync(process.stdout.fd, buf, offset, buf.length - offset);
      if (written <= 0) break; // should not happen; prevents infinite loop
      offset += written;
    }
  } catch (err) {
    // As a fallback, use original console which writes to stdout asynchronously
    if (header) originalConsole.warn(header);
    for (const line of lines) originalConsole.log(line);
  }
}

// Wait for the buffer to stabilize (no new lines for two checks) and then dump
export async function dumpBufferedLogsStabilized(header?: string, settleMs = 200, maxWaitMs = 2000): Promise<void> {
  let lastLen = -1;
  let stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const len = LOG_BUFFER.length;
    if (len === lastLen) {
      stableCount += 1;
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
      lastLen = len;
    }
    await new Promise((r) => setTimeout(r, settleMs));
  }
  dumpBufferedLogs(header);
}

export async function dumpBufferedLogsForToken(header: string, token: string, settleMs = 200, maxWaitMs = 30000): Promise<void> {
  let lastCount = -1;
  let stableCount = 0;
  const start = Date.now();
  const countForToken = () => LOG_ENTRIES.reduce((n, e) => n + (e.token === token ? 1 : 0), 0);
  while (Date.now() - start < maxWaitMs) {
    const n = countForToken();
    if (n === lastCount) {
      stableCount += 1;
      if (stableCount >= 2) break;
    } else {
      stableCount = 0;
      lastCount = n;
    }
    await new Promise((r) => setTimeout(r, settleMs));
  }
  const lines = LOG_ENTRIES.filter(e => e.token === token).map(e => e.line);
  if (lines.length === 0) return;
  const headerLine = header ? `=== ${header} ===\n` : "";
  const body = lines.join("\n") + "\n";
  try {
    const buf = Buffer.from(headerLine + body, "utf8");
    let offset = 0;
    while (offset < buf.length) {
      const written = fs.writeSync(process.stdout.fd, buf, offset, buf.length - offset);
      if (written <= 0) break;
      offset += written;
    }
  } catch (err) {
    if (header) originalConsole.warn(header);
    for (const line of lines) originalConsole.log(line);
  }
}

export function clearBufferedLogsForToken(token: string): void {
  if (!token) return clearBufferedLogs();
  for (let i = LOG_ENTRIES.length - 1; i >= 0; i--) {
    if (LOG_ENTRIES[i].token === token) LOG_ENTRIES.splice(i, 1);
  }
  // LOG_BUFFER is only used for whole-buffer dumps; keep as is
}

// Install interceptors immediately so any importing test benefits
(function configureLoggingInterceptors() {
  if (ENABLE_LOG) return;

  // Intercept console methods to buffer instead of printing
  (console as any).log = (...args: unknown[]) => pushToBuffer("console.log:", args);
  (console as any).info = (...args: unknown[]) => pushToBuffer("console.info:", args);
  (console as any).warn = (...args: unknown[]) => pushToBuffer("console.warn:", args);
  (console as any).error = (...args: unknown[]) => pushToBuffer("console.error:", args);

  // Intercept node-color-log while preserving chainability
  const bufferChain: any = {
    color: () => bufferChain,
    bold: () => bufferChain,
    italic: () => bufferChain,
    underline: () => bufferChain,
    bgColor: () => bufferChain,
    setLevel: () => bufferChain,
    setDate: () => bufferChain,
    setLabel: () => bufferChain,
    log: (...args: unknown[]) => pushToBuffer("logger.log:", args),
    info: (...args: unknown[]) => pushToBuffer("logger.info:", args),
    warn: (...args: unknown[]) => pushToBuffer("logger.warn:", args),
    error: (...args: unknown[]) => pushToBuffer("logger.error:", args),
  };
  try {
    (logger as any).log = (...args: unknown[]) => pushToBuffer("logger.log:", args);
    (logger as any).info = (...args: unknown[]) => pushToBuffer("logger.info:", args);
    (logger as any).warn = (...args: unknown[]) => pushToBuffer("logger.warn:", args);
    (logger as any).error = (...args: unknown[]) => pushToBuffer("logger.error:", args);
    (logger as any).color = () => bufferChain;
  } catch {}
})();

export default ENABLE_LOG;


