// A tiny MCP client: one JSON-RPC tools/call over Streamable HTTP. The
// VoiceMoat server is stateless, so no session handshake is needed.
import { bearer, serverUrl } from "./auth.mjs";

/** Reads a JSON-RPC message from a JSON body or a single SSE `data:` line. */
export function parseRpc(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (t.startsWith("{")) return JSON.parse(t);
  const lines = t.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (!lines.length) throw new Error("unexpected reply from the server");
  return JSON.parse(lines[lines.length - 1].slice(5).trim());
}

/** The tool's text content, parsed as JSON when it is JSON. */
export function resultPayload(result) {
  const text = (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  let data = null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { text, data, structured: result?.structuredContent ?? null, isError: Boolean(result?.isError) };
}

let nextId = 1;

export async function callTool(name, args, { store, env = process.env, fetchImpl = fetch } = {}) {
  const url = serverUrl(env);
  const send = async (force) => {
    const auth = await bearer({ store, env, force, fetchImpl });
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${auth.token}`,
        "User-Agent": "voicemoat-cli",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
    return { res, auth };
  };
  let { res, auth } = await send(false);
  if (res.status === 401 && auth.kind === "oauth") ({ res, auth } = await send(true));
  if (res.status === 401) {
    throw new Error(auth.kind === "key" ? "the API key was refused (revoked or mistyped)" : "your sign-in was refused. Run: voicemoat login");
  }
  if (res.status === 429) throw new Error("too many requests; wait a minute and try again");
  if (!res.ok) throw new Error(`server error (HTTP ${res.status})`);
  const msg = parseRpc(await res.text());
  if (msg?.error) throw new Error(msg.error.message || "the server returned an error");
  return resultPayload(msg?.result);
}
