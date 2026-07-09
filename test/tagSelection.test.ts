import assert from "node:assert/strict";
import test from "node:test";

import type { GitLabTag } from "../src/gitlab/types.js";
import { compareTagsByCreatedAtDesc } from "../src/release/tagSelection.js";

test("sorts tags by created_at desc and puts null created_at last", () => {
  const tags = [
    createTag("release/example-ui/v1.0.0", null),
    createTag("release/example-ui/v1.2.0", "2026-07-03T10:00:00.000Z"),
    createTag("release/example-ui/v1.1.0", "2026-07-01T10:00:00.000Z"),
  ];

  const sortedNames = tags.sort(compareTagsByCreatedAtDesc).map((tag) => tag.name);

  assert.deepEqual(sortedNames, [
    "release/example-ui/v1.2.0",
    "release/example-ui/v1.1.0",
    "release/example-ui/v1.0.0",
  ]);
});

function createTag(name: string, createdAt: string | null): GitLabTag {
  return {
    name,
    target: "commit-sha",
    message: null,
    protected: false,
    created_at: createdAt,
    commit: {
      id: "commit-sha",
      short_id: "commit",
      title: "commit title",
    },
  };
}
