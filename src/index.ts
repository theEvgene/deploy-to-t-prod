#!/usr/bin/env node
import * as childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";
import { logger } from "./logger.js";
import { isUserAbortError } from "./utils/abort.js";

const SYSTEM_CA_FLAG = "--use-system-ca";

function printMinimumVersionError(): void {
  console.error(
    "deploy-to-t-prod requires a Node.js runtime that supports --use-system-ca " +
      "(Node.js 22.15.0 or newer). Please upgrade Node.js and retry.",
  );
}

function supportsSystemCaVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > 22) {
    return true;
  }
  if (major < 22) {
    return false;
  }
  return minor >= 15;
}

type SystemCaSpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: unknown;
};

type SystemCaDeps = {
  spawnSyncFn?: (
    execPath: string,
    args: string[],
    options: { stdio: "inherit" },
  ) => SystemCaSpawnResult;
  exitFn?: (code: number) => never;
  killFn?: (pid: number, signal: NodeJS.Signals) => void;
  execArgv?: string[];
  argv?: string[];
  version?: string;
};

export function ensureSystemCa(deps?: SystemCaDeps): void {
  const execArgv = deps?.execArgv ?? process.execArgv;
  const argv = deps?.argv ?? process.argv;
  const version = deps?.version ?? process.version;
  const spawnSyncFn =
    deps?.spawnSyncFn ??
    (childProcess.spawnSync as unknown as SystemCaDeps["spawnSyncFn"] & Function) as NonNullable<
      SystemCaDeps["spawnSyncFn"]
    >;
  const exitFn = (deps?.exitFn ?? process.exit.bind(process)) as (code: number) => never;
  const killFn = (deps?.killFn ?? process.kill.bind(process)) as (
    pid: number,
    signal: NodeJS.Signals,
  ) => void;

  if (execArgv.includes(SYSTEM_CA_FLAG)) {
    return;
  }

  if (!supportsSystemCaVersion(version)) {
    printMinimumVersionError();
    exitFn(1);
    return;
  }

  let result: SystemCaSpawnResult;
  try {
    result = spawnSyncFn(process.execPath, [SYSTEM_CA_FLAG, ...execArgv, ...argv.slice(1)], {
      stdio: "inherit",
    });
  } catch {
    printMinimumVersionError();
    exitFn(1);
    return;
  }

  if (result.error) {
    printMinimumVersionError();
    exitFn(1);
    return;
  }

  if (result.signal) {
    killFn(process.pid, result.signal);
    exitFn(1);
    return;
  }

  exitFn(result.status ?? 1);
}

function isMainEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const normalize = (value: string): string => value.replace(/\\/g, "/");
  const normalizedEntry = normalize(entry);
  let current = "";
  try {
    current = normalize(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
  if (normalizedEntry === current) {
    return true;
  }
  const isIndexEntry =
    normalizedEntry.endsWith("/src/index.ts") || normalizedEntry.endsWith("/dist/index.js");
  const isCurrentIndex =
    current.endsWith("/src/index.ts") || current.endsWith("/dist/index.js");
  return isIndexEntry && isCurrentIndex;
}

if (isMainEntry()) {
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
}
