#!/usr/bin/env node
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";
import { logger } from "./logger.js";
import { isUserAbortError } from "./utils/abort.js";

const SYSTEM_CA_FLAG = "--use-system-ca";
const UNSUPPORTED_FLAG_EXIT_CODE = 9;

function printMinimumVersionError(): void {
  console.error(
    "deploy-to-t-prod requires a Node.js runtime that supports --use-system-ca " +
      "(Node.js 22.15.0 or newer, or 23.8.0 or newer on the 23.x line). " +
      "Please upgrade Node.js and retry.",
  );
}

function printUnsupportedFlagError(version: string): void {
  console.error(
    `deploy-to-t-prod could not start Node.js with ${SYSTEM_CA_FLAG}: ` +
      `the runtime (${version}) rejected the flag with exit code ${UNSUPPORTED_FLAG_EXIT_CODE}. ` +
      "Use Node.js 22.15.0 or newer (or 23.8.0 or newer on the 23.x line) and retry.",
  );
}

function supportsSystemCaVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 22) {
    return false;
  }
  if (major === 22) {
    return minor >= 15;
  }
  if (major === 23) {
    return minor >= 8;
  }
  return true;
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

  if (result.status === UNSUPPORTED_FLAG_EXIT_CODE) {
    printUnsupportedFlagError(version);
    exitFn(UNSUPPORTED_FLAG_EXIT_CODE);
    return;
  }

  exitFn(result.status ?? 1);
}

type MainEntryDeps = {
  entry?: string;
  moduleUrl?: string;
  realpath?: (filePath: string) => string;
};

function defaultRealpath(filePath: string): string {
  const absolute = path.resolve(filePath);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return fs.realpathSync(absolute);
  }
}

function canonicalPath(
  filePath: string,
  realpath: (value: string) => string,
): string | null {
  try {
    return realpath(filePath);
  } catch {
    return null;
  }
}

function normalizePath(value: string, platform: NodeJS.Platform): string {
  const slashes = value.replace(/\\/g, "/");
  return platform === "win32" ? slashes.toLowerCase() : slashes;
}

export function isMainEntry(deps?: MainEntryDeps): boolean {
  const entry = deps?.entry ?? process.argv[1];
  const moduleUrl = deps?.moduleUrl ?? import.meta.url;
  const realpath = deps?.realpath ?? defaultRealpath;
  if (!entry) {
    return false;
  }

  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }

  // Resolve symlinks/junctions on both sides so an installed bin shim,
  // a linked package directory, or an aliased entry point still matches.
  const entryPath = canonicalPath(entry, realpath);
  const currentPath = canonicalPath(modulePath, realpath);
  if (!entryPath || !currentPath) {
    return false;
  }

  return normalizePath(entryPath, process.platform) === normalizePath(currentPath, process.platform);
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
