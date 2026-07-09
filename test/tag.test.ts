import assert from "node:assert/strict";
import test from "node:test";

import {
  isGitLabReleaseTagName,
  parseGitLabReleaseTagName,
  parseReleaseVersion,
  toGitLabReleaseTagName,
} from "../src/tag.js";
import type { ReleaseConfig } from "../src/constants.js";

const testReleaseConfig: ReleaseConfig = {
  gitlabBaseUrl: "https://gitlab.example.com",
  projectPath: "team/example-ui",
  branch: "master",
  manualJobName: "deploy:production",
  releaseTagPrefix: "release/example-ui/v",
  pollIntervalSeconds: 15,
  manualJobTimeoutMinutes: 15,
  pipelineTimeoutMinutes: 10,
};

test("parses valid release versions", () => {
  assert.equal(parseReleaseVersion("1.23.45"), "1.23.45");
  assert.equal(parseReleaseVersion("14.1.13"), "14.1.13");
});

test("rejects invalid release versions", () => {
  assert.throws(() => parseReleaseVersion("release/example-ui/v1.23.45"), /Invalid tag version/);
  assert.throws(() => parseReleaseVersion("v1.23.45"), /Invalid tag version/);
  assert.throws(() => parseReleaseVersion("1.23"), /Invalid tag version/);
  assert.throws(() => parseReleaseVersion("1.23.45-test"), /Invalid tag version/);
});

test("formats GitLab release tag names from release versions", () => {
  const version = parseReleaseVersion("1.23.45");

  assert.equal(toGitLabReleaseTagName(version, testReleaseConfig), "release/example-ui/v1.23.45");
});

test("detects and parses GitLab release tag names", () => {
  assert.equal(isGitLabReleaseTagName("release/example-ui/v1.23.45", testReleaseConfig), true);
  assert.equal(isGitLabReleaseTagName("1.23.45", testReleaseConfig), false);
  assert.equal(
    parseGitLabReleaseTagName("release/example-ui/v1.23.45", testReleaseConfig),
    "release/example-ui/v1.23.45",
  );
});
