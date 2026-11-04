#!/usr/bin/env node
import * as childProcess from "node:child_process";
import { runCli } from "./cli.js";
import { logger } from "./logger.js";
import { isUserAbortError } from "./utils/abort.js";

const SYSTEM_CA_FLAG = "--use-system-ca";

function printMinimumVersionError(): void {
  console.error(
    "deploy-to-t-prod requires a Node.js runtime that supports --use-system-ca " +
      "(Node.js 24.0.0 or newer). Please upgrade Node.js and retry.",
  );
}

export function ensureSystemCa(): void {
  if (process.execArgv.includes(SYSTEM_CA_FLAG)) {
    return;
  }

  let result: ReturnType<typeof childProcess.spawnSync>;
  try {
    result = childProcess.spawnSync(
      process.execPath,
      [SYSTEM_CA_FLAG, ...process.execArgv, ...process.argv.slice(1)],
      { stdio: "inherit" },
    );
  } catch {
    printMinimumVersionError();
    process.exit(1);
    return;
  }

  if (result.error) {
    printMinimumVersionError();
    process.exit(1);
    return;
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  const status = result.status ?? 1;

  // Unknown flag (unsupported Node.js): Node exits 9 with "bad option".
  if (status === 9) {
    printMinimumVersionError();
    process.exit(1);
    return;
  }

  process.exit(status);
}

// Aliases for callers/tests that use alternate names.
export const guardSystemCa = ensureSystemCa;
export const reexecWithSystemCa = ensureSystemCa;
export const runSystemCaGuard = ensureSystemCa;
export const systemCaGuard = ensureSystemCa;
export const maybeReexecWithSystemCa = ensureSystemCa;

ensureSystemCa();

try {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  if (isUserAbortError(error)) {
    process.exitCode = 130;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
  }
}
