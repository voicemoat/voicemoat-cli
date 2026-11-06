import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, readInput, formatValue, main } from "../src/cli.mjs";
import { parseRpc, resultPayload } from "../src/mcp.mjs";
import { createStore } from "../src/store.mjs";
import { bearer } from "../src/auth.mjs";

const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "vm-cli-"));
  return { store: createStore(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

test("parseArgs: command, positionals, value and boolean flags", () => {
  assert.deepEqual(parseArgs(["ideas", "remote", "work", "--platform", "linkedin", "--json", "--count=3"]), {
    cmd: "ideas",
    args: ["remote", "work"],
    flags: { platform: "linkedin", json: true, count: "3" },
  });
  assert.deepEqual(parseArgs(["-h"]).flags, { help: true });
  assert.deepEqual(parseArgs(["check", "-"]).args, ["-"]);
});

test("readInput: literal, @file and stdin", () => {
  const io = { readFile: (p) => `file:${p}\n`, stdin: () => " from stdin \n" };
  assert.equal(readInput(["hello", "world"], io), "hello world");
  assert.equal(readInput(["@draft.md"], io), "file:draft.md");
  assert.equal(readInput(["-"], io), "from stdin");
  assert.equal(readInput([], io), "");
});

test("formatValue: readable nested output", () => {
  const s = formatValue({ account_name: "Pat", ideas: [{ hook: "One" }, "Two"] });
  assert.match(s, /account name: Pat/);
  assert.match(s, /- hook: One/);
  assert.match(s, /- Two/);
});

test("parseRpc: JSON body and SSE data line", () => {
  assert.deepEqual(parseRpc('{"id":1,"result":{}}'), { id: 1, result: {} });
  assert.deepEqual(parseRpc('event: message\ndata: {"id":2,"result":{"ok":true}}\n\n'), { id: 2, result: { ok: true } });
  assert.equal(parseRpc(""), null);
});

test("resultPayload: parses JSON text and flags errors", () => {
  const r = resultPayload({ content: [{ type: "text", text: '{"a":1}' }], isError: true });
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.isError, true);
  assert.equal(resultPayload({ content: [{ type: "text", text: "plain" }] }).data, null);
});

test("store: pending previews expire and are taken once", () => {
  const { store, cleanup } = tmpStore();
  try {
    const now = Date.parse("2026-11-06T10:00:00Z");
    const id = store.addPending({ tool: "publish_post", args: { content: "x", platform: "linkedin" }, token: "t", expires_at: "2026-11-06T10:10:00Z" }, now);
    assert.match(id, /^[0-9A-F]{6}$/);
    assert.equal(Object.keys(store.listPending(now)).length, 1);
    assert.equal(Object.keys(store.listPending(Date.parse("2026-11-06T10:11:00Z"))).length, 0);
    assert.ok(store.takePending(id.toLowerCase(), now));
    assert.equal(store.takePending(id, now), null);
  } finally {
    cleanup();
  }
});

test("bearer: API key wins; expired OAuth without refresh asks to log in", async () => {
  const { store, cleanup } = tmpStore();
  try {
    assert.deepEqual(await bearer({ store, env: { VOICEMOAT_API_KEY: " vm_live_abc " } }), { token: "vm_live_abc", kind: "key" });
    await assert.rejects(bearer({ store, env: {} }), /not signed in/);
    store.writeConfig({ server: "https://app.voicemoat.com/api/mcp", access_token: "a", expires_at: "2000-01-01T00:00:00Z" });
    await assert.rejects(bearer({ store, env: {} }), /expired/);
  } finally {
    cleanup();
  }
});

test("main: preview, then confirm sends the token, account and same text", async () => {
  const { store, cleanup } = tmpStore();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ auth: init.headers.Authorization, name: body.params.name, args: body.params.arguments });
    const a = body.params.arguments;
    const payload = a.confirmation_token
      ? { status: "published", platform: a.platform, url: "https://example.com/p/1" }
      : { status: "confirm_required", platform: a.platform, account: { id: "acc-1", name: "Pat" }, content: a.content, confirmation_token: "tok-123", expires_at: new Date(Date.now() + 600000).toISOString() };
    return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })}\n\n`, { status: 200 });
  };
  const lines = [];
  const env = { VOICEMOAT_API_KEY: "vm_live_test" };
  try {
    assert.equal(await main(["publish", "linkedin", "Shipped", "today."], { store, env, out: (s) => lines.push(s), err: (s) => lines.push(s) }), 0);
    const idLine = lines.find((l) => l.includes("voicemoat confirm "));
    assert.ok(idLine, "prints the confirm command");
    assert.ok(lines.some((l) => l.includes("Nothing has been posted")));
    const id = idLine.trim().split(" ").pop();
    assert.equal(await main(["confirm", id], { store, env, out: (s) => lines.push(s), err: (s) => lines.push(s) }), 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].auth, "Bearer vm_live_test");
    assert.deepEqual(calls[1].args, { platform: "linkedin", content: "Shipped today.", account_id: "acc-1", confirmation_token: "tok-123" });
    await assert.rejects(main(["confirm", id], { store, env, out: () => {}, err: () => {} }), /no preview/);
  } finally {
    globalThis.fetch = realFetch;
    cleanup();
  }
});

test("main: schedule needs a readable --at and converts it to ISO UTC", async () => {
  const { store, cleanup } = tmpStore();
  try {
    await assert.rejects(main(["schedule", "linkedin", "hi"], { store, env: { VOICEMOAT_API_KEY: "k" }, out: () => {}, err: () => {} }), /say when/);
    await assert.rejects(main(["schedule", "linkedin", "hi", "--at", "next tuesday-ish"], { store, env: { VOICEMOAT_API_KEY: "k" }, out: () => {}, err: () => {} }), /could not read --at/);
    await assert.rejects(main(["publish", "facebook", "hi"], { store, env: { VOICEMOAT_API_KEY: "k" }, out: () => {}, err: () => {} }), /unknown platform/);
  } finally {
    cleanup();
  }
});

test("main: help, version and unknown command", async () => {
  const out = [];
  assert.equal(await main(["--version"], { out: (s) => out.push(s) }), 0);
  assert.match(out[0], /^\d+\.\d+\.\d+$/);
  assert.equal(await main([], { out: (s) => out.push(s) }), 0);
  assert.match(out[1], /voicemoat login/);
  assert.equal(await main(["frobnicate"], { out: () => {}, err: (s) => out.push(s) }), 2);
});
