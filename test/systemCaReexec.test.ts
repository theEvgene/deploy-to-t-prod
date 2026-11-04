import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSystemCa } from "../src/index.js";

type SpawnResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: unknown;
};

type SpawnCall = {
  execPath: string;
  args: string[];
  options: { stdio: "inherit" };
};

function makeHarness(impl: () => SpawnResult) {
  const spawnCalls: SpawnCall[] = [];
  const exitCalls: number[] = [];
  const killCalls: { pid: number; signal: NodeJS.Signals }[] = [];
  let spawnImpl = impl;

  const spawnSyncFn = (execPath: string, args: string[], options: { stdio: "inherit" }) => {
    spawnCalls.push({ execPath, args, options });
    return spawnImpl();
  };
  const exitFn = ((code: number): never => {
    exitCalls.push(code);
    throw new Error(`EXIT:${code}`);
  }) as (code: number) => never;
  const killFn = ((pid: number, signal: NodeJS.Signals): void => {
    killCalls.push({ pid, signal });
    throw new Error(`KILL:${String(signal)}`);
  }) as (pid: number, signal: NodeJS.Signals) => void;

  return {
    spawnCalls,
    exitCalls,
    killCalls,
    spawnSyncFn,
    exitFn,
    killFn,
    setSpawnImpl(next: () => SpawnResult): void {
      spawnImpl = next;
    },
  };
}

function captureConsoleError(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  return {
    messages,
    restore: () => {
      console.error = original;
    },
  };
}

const SUPPORTED_VERSION = "v24.18.0";

test("does not respawn when --use-system-ca is already present", () => {
  const harness = makeHarness(() => ({ status: 0, signal: null }));
  const beforeEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  ensureSystemCa({
    ...harness,
    execArgv: ["--use-system-ca"],
    argv: [process.execPath, "script.js", "--help"],
    version: SUPPORTED_VERSION,
  });
  assert.equal(harness.spawnCalls.length, 0);
  assert.equal(harness.exitCalls.length, 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, beforeEnv);
});

test("respawns exactly once with identical args when flag is absent", () => {
  const harness = makeHarness(() => ({ status: 0, signal: null }));
  const beforeEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  assert.throws(
    () =>
      ensureSystemCa({
        ...harness,
        execArgv: ["--foo"],
        argv: [process.execPath, "script.js", "arg1"],
        version: SUPPORTED_VERSION,
      }),
    /EXIT:0/,
  );
  assert.equal(harness.spawnCalls.length, 1);
  const call = harness.spawnCalls[0];
  assert.equal(call.execPath, process.execPath);
  assert.deepEqual(call.args, ["--use-system-ca", "--foo", "script.js", "arg1"]);
  assert.deepEqual(call.options, { stdio: "inherit" });
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, beforeEnv);
});

test("propagates child exit code", () => {
  const harness = makeHarness(() => ({ status: 42, signal: null }));
  assert.throws(
    () =>
      ensureSystemCa({
        ...harness,
        execArgv: [],
        argv: [process.execPath, "script.js"],
        version: SUPPORTED_VERSION,
      }),
    /EXIT:42/,
  );
  assert.ok(harness.exitCalls.includes(42));
});

test("forwards child signal without falling through to the CLI", () => {
  const harness = makeHarness(() => ({ status: null, signal: "SIGTERM" }));
  assert.throws(
    () =>
      ensureSystemCa({
        ...harness,
        execArgv: [],
        argv: [process.execPath, "script.js"],
        version: SUPPORTED_VERSION,
      }),
    /KILL:SIGTERM/,
  );
  assert.equal(harness.killCalls.length, 1);
  assert.equal(harness.killCalls[0].pid, process.pid);
  assert.equal(harness.killCalls[0].signal, "SIGTERM");
  assert.equal(harness.exitCalls.length, 0);
});

test("exits non-zero when signal forwarding does not terminate the process", () => {
  const exitCalls: number[] = [];
  const killCalls: { pid: number; signal: NodeJS.Signals }[] = [];
  assert.throws(
    () =>
      ensureSystemCa({
        spawnSyncFn: () => ({ status: null, signal: "SIGTERM" }),
        exitFn: ((code: number): never => {
          exitCalls.push(code);
          throw new Error(`EXIT:${code}`);
        }) as (code: number) => never,
        killFn: ((pid: number, signal: NodeJS.Signals): void => {
          killCalls.push({ pid, signal });
        }) as (pid: number, signal: NodeJS.Signals) => void,
        execArgv: [],
        argv: [process.execPath, "script.js"],
        version: SUPPORTED_VERSION,
      }),
    /EXIT:1/,
  );
  assert.equal(killCalls.length, 1);
  assert.ok(exitCalls.includes(1));
});

test("propagates status 9 as-is on supported runtimes", () => {
  const harness = makeHarness(() => ({ status: 9, signal: null }));
  const capture = captureConsoleError();
  try {
    assert.throws(
      () =>
        ensureSystemCa({
          ...harness,
          execArgv: [],
          argv: [process.execPath, "script.js"],
          version: SUPPORTED_VERSION,
        }),
      /EXIT:9/,
    );
    assert.ok(harness.exitCalls.includes(9));
    assert.equal(capture.messages.length, 0);
  } finally {
    capture.restore();
  }
});

test("rejects runtimes older than 22.15 without spawning", () => {
  const harness = makeHarness(() => ({ status: 0, signal: null }));
  const capture = captureConsoleError();
  try {
    assert.throws(
      () =>
        ensureSystemCa({
          ...harness,
          execArgv: [],
          argv: [process.execPath, "script.js"],
          version: "v22.14.0",
        }),
      /EXIT:1/,
    );
    assert.equal(harness.spawnCalls.length, 0);
    assert.ok(harness.exitCalls.includes(1));
    assert.ok(capture.messages.some((message) => /22\.15\.0/.test(message)));
    assert.ok(capture.messages.some((message) => /use-system-ca/.test(message)));
  } finally {
    capture.restore();
  }
});

test("accepts 22.15.0 as the minimum supported runtime", () => {
  const harness = makeHarness(() => ({ status: 0, signal: null }));
  assert.throws(
    () =>
      ensureSystemCa({
        ...harness,
        execArgv: [],
        argv: [process.execPath, "script.js"],
        version: "v22.15.0",
      }),
    /EXIT:0/,
  );
  assert.equal(harness.spawnCalls.length, 1);
});

test("spawn failure exits non-zero with a minimum-version error", () => {
  const harness = makeHarness(() => ({ status: null, signal: null, error: new Error("bad option") }));
  const capture = captureConsoleError();
  try {
    assert.throws(
      () =>
        ensureSystemCa({
          ...harness,
          execArgv: [],
          argv: [process.execPath, "script.js"],
          version: SUPPORTED_VERSION,
        }),
      /EXIT:1/,
    );
    assert.ok(harness.exitCalls.includes(1));
    assert.ok(capture.messages.some((message) => /22\.15\.0/.test(message)));
  } finally {
    capture.restore();
  }
});

test("never sets or passes insecure TLS verification env", () => {
  const harness = makeHarness(() => ({ status: 0, signal: null }));
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    ensureSystemCa({
      ...harness,
      execArgv: [],
      argv: [process.execPath, "script.js"],
      version: SUPPORTED_VERSION,
    });
  } catch {
    // exitFn always throws in tests.
  }
  assert.equal(harness.spawnCalls.length, 1);
  assert.equal((harness.spawnCalls[0].options as { env?: unknown }).env, undefined);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});
