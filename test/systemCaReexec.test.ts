import assert from "node:assert/strict";
import { mock, test } from "node:test";

const spawnSyncMock = mock.fn(() => ({ status: 0, signal: null, error: undefined }));

mock.module("node:child_process", {
  exports: {
    spawnSync: spawnSyncMock,
  },
});

const exitCalls: number[] = [];
process.exit = ((code?: number) => {
  exitCalls.push(code ?? 0);
  throw new Error(`EXIT:${code ?? 0}`);
}) as never;

const killCalls: { pid: number; signal: any }[] = [];
process.kill = ((pid: number, signal: any) => {
  killCalls.push({ pid, signal });
  throw new Error(`KILL:${signal}`);
}) as never;

process.execArgv = ["--use-system-ca"];
process.argv = [process.execPath, "index.js", "--help"];

const mod = await import("../src/index.js");
const ensureSystemCa = mod.ensureSystemCa as () => void;

test("does not respawn when --use-system-ca is already present", () => {
  spawnSyncMock.mock.resetCalls();
  exitCalls.length = 0;
  killCalls.length = 0;
  process.execArgv = ["--use-system-ca"];
  const beforeEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  ensureSystemCa();
  assert.equal(spawnSyncMock.mock.calls.length, 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, beforeEnv);
});

test("respawns exactly once with identical args when flag is absent", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: 0, signal: null, error: undefined }));
  exitCalls.length = 0;
  killCalls.length = 0;
  process.execArgv = ["--foo"];
  process.argv = [process.execPath, "script.js", "arg1"];
  const beforeEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  assert.throws(() => ensureSystemCa(), /EXIT:0/);
  assert.equal(spawnSyncMock.mock.calls.length, 1);
  const call = spawnSyncMock.mock.calls[0];
  assert.equal(call.arguments[0], process.execPath);
  assert.deepEqual(call.arguments[1], ["--use-system-ca", "--foo", "script.js", "arg1"]);
  assert.deepEqual(call.arguments[2], { stdio: "inherit" });
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, beforeEnv);
});

test("propagates child exit code", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: 42, signal: null, error: undefined }));
  exitCalls.length = 0;
  process.execArgv = [];
  process.argv = [process.execPath, "script.js"];
  assert.throws(() => ensureSystemCa(), /EXIT:42/);
  assert.ok(exitCalls.includes(42));
});

test("propagates child signal", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: null, signal: "SIGTERM", error: undefined }));
  killCalls.length = 0;
  process.execArgv = [];
  process.argv = [process.execPath, "script.js"];
  assert.throws(() => ensureSystemCa(), /KILL:SIGTERM/);
  assert.equal(killCalls.length, 1);
  assert.equal(killCalls[0].signal, "SIGTERM");
});

test("unsupported flag exits non-zero with a minimum-version error", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: 9, signal: null, error: undefined }));
  exitCalls.length = 0;
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: any[]) => {
    errors.push(a.join(" "));
  };
  process.execArgv = [];
  process.argv = [process.execPath, "script.js"];
  assert.throws(() => ensureSystemCa(), /EXIT:1/);
  console.error = origError;
  assert.ok(exitCalls.includes(1));
  assert.ok(errors.some((e) => /use-system-ca|Node\.js|version/i.test(e)));
});

test("spawn error exits non-zero with a minimum-version error", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: null, signal: null, error: new Error("bad option") }));
  exitCalls.length = 0;
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: any[]) => {
    errors.push(a.join(" "));
  };
  process.execArgv = [];
  process.argv = [process.execPath, "script.js"];
  assert.throws(() => ensureSystemCa(), /EXIT:1/);
  console.error = origError;
  assert.ok(exitCalls.includes(1));
  assert.ok(errors.some((e) => /use-system-ca|Node\.js|version/i.test(e)));
});

test("never sets or passes insecure TLS verification env", () => {
  spawnSyncMock.mock.resetCalls();
  spawnSyncMock.mock.mockImplementation(() => ({ status: 0, signal: null, error: undefined }));
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  exitCalls.length = 0;
  process.execArgv = [];
  process.argv = [process.execPath, "script.js"];
  try {
    ensureSystemCa();
  } catch {
    // process.exit may throw
  }
  const call = spawnSyncMock.mock.calls[0];
  assert.ok(call, "spawnSync should be called once");
  assert.equal(call.arguments[2]?.env, undefined);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});
