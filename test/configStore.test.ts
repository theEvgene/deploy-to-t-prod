import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { maskToken, readConfig } from "../src/config/configStore.js";

test("masks missing token", () => {
  assert.equal(maskToken(undefined), "not configured");
});

test("masks short token completely", () => {
  assert.equal(maskToken("12345678"), "****");
});

test("masks long token without exposing middle", () => {
  assert.equal(maskToken("glpat-1234567890abcd"), "glpat-****abcd");
});

test("reads local config with UTF-8 BOM", async () => {
  const originalAppData = process.env.APPDATA;
  const tempAppData = await mkdtemp(join(tmpdir(), "release-tag-config-"));

  try {
    process.env.APPDATA = tempAppData;
    const configDirectory = join(tempAppData, "release-tag");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "config.json"),
      "\ufeff{\"gitlabBaseUrl\":\"https://gitlab.example.com\",\"projectPath\":\"group/project\",\"manualJobName\":\"deploy\"}\n",
      "utf8",
    );

    assert.deepEqual(await readConfig(), {
      gitlabToken: undefined,
      gitlabBaseUrl: "https://gitlab.example.com",
      projectPath: "group/project",
      manualJobName: "deploy",
    });
  } finally {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    await rm(tempAppData, { recursive: true, force: true });
  }
});
