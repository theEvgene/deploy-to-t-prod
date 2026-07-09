import assert from "node:assert/strict";
import test from "node:test";

import { maskToken } from "../src/config/configStore.js";

test("masks missing token", () => {
  assert.equal(maskToken(undefined), "not configured");
});

test("masks short token completely", () => {
  assert.equal(maskToken("12345678"), "****");
});

test("masks long token without exposing middle", () => {
  assert.equal(maskToken("glpat-1234567890abcd"), "glpat-****abcd");
});

