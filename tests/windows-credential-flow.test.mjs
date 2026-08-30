import assert from "node:assert/strict";
import test from "node:test";
import { obtainLoginCredential } from "../dist/auth/browser-auth.js";

const stored = { username: "user@example.com", password: "secret" };

test("uses an existing Windows credential without prompting", async () => {
  let prompted = false;
  const result = await obtainLoginCredential("FlowAccountMCP", 120000, {
    platform: "win32",
    read: async () => stored,
    prompt: async () => { prompted = true; return true; },
  });
  assert.deepEqual(result, stored);
  assert.equal(prompted, false);
});

test("opens Credential Manager and waits when the credential is missing", async () => {
  const calls = [];
  const result = await obtainLoginCredential("FlowAccountMCP", 120000, {
    platform: "win32",
    read: async () => null,
    prompt: async (target) => { calls.push(["prompt", target]); return true; },
    wait: async (target, timeoutMs) => {
      calls.push(["wait", target, timeoutMs]);
      return stored;
    },
  });
  assert.deepEqual(result, stored);
  assert.deepEqual(calls, [
    ["prompt", "FlowAccountMCP"],
    ["wait", "FlowAccountMCP", 120000],
  ]);
});

test("returns actionable guidance when the user declines Credential Manager", async () => {
  await assert.rejects(
    obtainLoginCredential("FlowAccountMCP", 120000, {
      platform: "win32",
      read: async () => null,
      prompt: async () => false,
    }),
    /Credential Manager was not opened.*Internet or network address "FlowAccountMCP"/s
  );
});

test("returns actionable guidance when credential setup times out", async () => {
  await assert.rejects(
    obtainLoginCredential("FlowAccountMCP", 5000, {
      platform: "win32",
      read: async () => null,
      prompt: async () => true,
      wait: async () => null,
    }),
    /not added within 5 seconds/
  );
});

test("uses visible interactive login when no credential target is configured", async () => {
  let prompted = false;
  const result = await obtainLoginCredential("", 120000, {
    platform: "win32",
    read: async () => null,
    prompt: async () => { prompted = true; return true; },
  });
  assert.equal(result, null);
  assert.equal(prompted, false);
});
