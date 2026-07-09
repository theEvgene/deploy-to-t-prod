import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { enforceRunsRetention } from "../src/artifacts/runArtifacts.js";

test("keeps only last 10 run artifact directories", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "release-tag-runs-"));

  try {
    const runsDirectory = join(tempRoot, "runs");
    await mkdir(runsDirectory, { recursive: true });

    for (let index = 1; index <= 12; index += 1) {
      await mkdir(join(runsDirectory, `2026-07-09T10-00-${String(index).padStart(2, "0")}-000Z_release_v1`));
    }

    await enforceRunsRetention(runsDirectory);

    const remainingDirectories = (await readdir(runsDirectory)).sort();
    assert.deepEqual(remainingDirectories, [
      "2026-07-09T10-00-03-000Z_release_v1",
      "2026-07-09T10-00-04-000Z_release_v1",
      "2026-07-09T10-00-05-000Z_release_v1",
      "2026-07-09T10-00-06-000Z_release_v1",
      "2026-07-09T10-00-07-000Z_release_v1",
      "2026-07-09T10-00-08-000Z_release_v1",
      "2026-07-09T10-00-09-000Z_release_v1",
      "2026-07-09T10-00-10-000Z_release_v1",
      "2026-07-09T10-00-11-000Z_release_v1",
      "2026-07-09T10-00-12-000Z_release_v1",
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
