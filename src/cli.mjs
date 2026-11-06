import { readFileSync } from "node:fs";
import { createStore } from "./store.mjs";
import { login, serverUrl } from "./auth.mjs";
import { callTool } from "./mcp.mjs";

export const VERSION = "0.1.0";

const HELP = `VoiceMoat from your terminal (v${VERSION})

Sign in
  voicemoat login                 Sign in with your browser (same screen as Claude)
  voicemoat logout                Forget the sign-in on this computer
  Servers and agents: set VOICEMOAT_API_KEY to a personal key instead.

Read
  voicemoat me                    Your account and plan
  voicemoat profiles              Connected LinkedIn and Twitter profiles
  voicemoat voice    [--platform linkedin|twitter]
  voicemoat insights [--platform linkedin|twitter]
  voicemoat analytics [--platform ...] [--window today|yesterday|7d|30d]
  voicemoat posts    [--window ...] [--limit N]
  voicemoat post <post_id>
  voicemoat creators [--limit N]
  voicemoat inspiration <query> [--limit N]

Draft and check (text, @file, or - for stdin)
  voicemoat check   <text>        Style and Stance against your voice
  voicemoat improve <text> [--full] [--platform ...] [--thread]
  voicemoat ideas   <topic> [--platform ...] [--count N]
  voicemoat hooks   <topic> [--platform ...]

Post (always a preview first; nothing posts until you confirm)
  voicemoat publish  <linkedin|twitter> <text>
  voicemoat schedule <linkedin|twitter> <text> --at <ISO date and time>
  voicemoat confirm  <id>         Post the previewed text (once, before it expires)
  voicemoat pending               Previews waiting for confirmation

Options
  --json      Machine-readable output (for agents and scripts)
  --account   Account id, when you have more than one on a platform
  -h, --help  This help    -v, --version  Version

More: https://voicemoat.com/mcp`;

const WINDOWS = { today: "today", yesterday: "yesterday", "7d": "last_7_days", "30d": "last_30_days", last_7_days: "last_7_days", last_30_days: "last_30_days" };
const PLATFORMS = new Set(["linkedin", "twitter"]);
const BOOLEAN_FLAGS = new Set(["json", "full", "thread", "help", "version"]);
const ALIASES = { h: "help", v: "version", p: "platform", n: "limit" };

/** argv -> { cmd, args, flags }. Supports --k v, --k=v, and boolean flags. */
export function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-") {
      args.push(a);
    } else if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (BOOLEAN_FLAGS.has(k)) flags[k] = true;
      else flags[k] = inline !== undefined ? inline : argv[++i];
    } else if (a.startsWith("-") && a.length === 2) {
      const k = ALIASES[a[1]] ?? a[1];
      if (BOOLEAN_FLAGS.has(k)) flags[k] = true;
      else flags[k] = argv[++i];
    } else {
      args.push(a);
    }
  }
  return { cmd: args.shift(), args, flags };
}

/** Text from an argument: literal text, @path for a file, or - for stdin. */
export function readInput(parts, { readFile = (p) => readFileSync(p, "utf8"), stdin = () => readFileSync(0, "utf8") } = {}) {
  if (!parts.length) return "";
  if (parts.length === 1 && parts[0] === "-") return stdin().trim();
  if (parts.length === 1 && parts[0].startsWith("@") && parts[0].length > 1) return readFile(parts[0].slice(1)).trim();
  return parts.join(" ").trim();
}

function need(value, message) {
  if (value === undefined || value === null || value === "") throw new Error(message);
  return value;
}

function platformFlag(flags, required = false) {
  const p = flags.platform;
  if (p === undefined) {
    if (required) throw new Error("say which platform: linkedin or twitter");
    return undefined;
  }
  if (!PLATFORMS.has(p)) throw new Error(`unknown platform "${p}": use linkedin or twitter`);
  return p;
}

function windowFlag(flags) {
  if (flags.window === undefined) return undefined;
  const w = WINDOWS[flags.window];
  if (!w) throw new Error(`unknown window "${flags.window}": use today, yesterday, 7d or 30d`);
  return w;
}

function intFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const n = Number(flags[name]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number`);
  return n;
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Readable text for any JSON value (keys as labels, lists as bullets). */
export function formatValue(value, indent = "") {
  if (value === null || value === undefined) return `${indent}-`;
  if (typeof value !== "object") return `${indent}${value}`;
  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const inner = formatValue(item, `${indent}  `).split("\n");
        lines.push(`${indent}- ${inner[0].trimStart()}`, ...inner.slice(1));
      } else {
        lines.push(`${indent}- ${item}`);
      }
    }
    return lines.join("\n") || `${indent}(none)`;
  }
  for (const [k, v] of Object.entries(value)) {
    const label = k.replace(/_/g, " ");
    if (v && typeof v === "object") lines.push(`${indent}${label}:`, formatValue(v, `${indent}  `));
    else if (typeof v === "string" && v.includes("\n")) {
      lines.push(`${indent}${label}:`, ...v.split("\n").map((l) => `${indent}  ${l}`));
    } else lines.push(`${indent}${label}: ${v ?? "-"}`);
  }
  return lines.join("\n");
}

const READ = {
  me: () => ["get_me", {}],
  whoami: () => ["get_me", {}],
  profiles: () => ["list_profiles", {}],
  voice: (a, f) => ["get_voice_profile", clean({ platform: platformFlag(f) })],
  insights: (a, f) => ["get_voice_insights", clean({ platform: platformFlag(f) })],
  analytics: (a, f) => ["get_analytics", clean({ platform: platformFlag(f), window: windowFlag(f) })],
  posts: (a, f) => ["list_posts", clean({ window: windowFlag(f), limit: intFlag(f, "limit") })],
  post: (a) => ["get_post", { post_id: need(a[0], "give a post id: voicemoat post <post_id>") }],
  creators: (a, f) => ["list_creators", clean({ limit: intFlag(f, "limit") })],
  inspiration: (a, f) => ["search_inspiration", clean({ query: a.join(" ") || undefined, limit: intFlag(f, "limit") })],
  check: (a, f, io) => ["score_voice_match", { content: need(readInput(a, io), "give the text to check") }],
  improve: (a, f, io) => [
    "improve_post",
    clean({ content: need(readInput(a, io), "give the text to improve"), mode: f.full ? "full" : "quick", platform: platformFlag(f), is_thread: f.thread ? true : undefined }),
  ],
  ideas: (a, f) => ["get_post_ideas", clean({ topic: need(a.join(" "), "give a topic"), platform: platformFlag(f), count: intFlag(f, "count") })],
  hooks: (a, f) => ["suggest_hooks", clean({ topic: need(a.join(" "), "give a topic"), platform: platformFlag(f) })],
};

function postArgs(cmd, a, f, io) {
  const platform = need(a[0], `say where to post: voicemoat ${cmd} linkedin|twitter <text>`);
  if (!PLATFORMS.has(platform)) throw new Error(`unknown platform "${platform}": use linkedin or twitter`);
  const content = need(readInput(a.slice(1), io), "give the text to post");
  const args = clean({ platform, content, account_id: f.account });
  if (cmd === "schedule") {
    const at = need(f.at, "say when: --at 2026-11-07T09:00:00+05:30");
    if (Number.isNaN(Date.parse(at))) throw new Error(`could not read --at "${at}": use an ISO date and time`);
    args.scheduled_for = new Date(at).toISOString();
  }
  return [cmd === "publish" ? "publish_post" : "schedule_post", args];
}

export async function main(argv, { store = createStore(), env = process.env, out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`), io } = {}) {
  const { cmd, args, flags } = parseArgs(argv);
  if (flags.version) return out(VERSION), 0;
  if (!cmd || flags.help || cmd === "help") return out(HELP), 0;
  const show = (payload) => {
    if (flags.json) out(JSON.stringify(payload.structured ?? payload.data ?? payload.text, null, 2));
    else out(payload.data ? formatValue(payload.data) : payload.text);
  };

  if (cmd === "login") {
    const config = await login({ store, env, log: err });
    const me = await callTool("get_me", {}, { store, env });
    const acct = me.data?.account ?? {};
    out(`Signed in${acct.email ? ` as ${acct.email}` : ""}${acct.plan ? ` (${String(acct.plan).replace(/_Subscription$/, "")})` : ""}.`);
    if (config.server !== "https://app.voicemoat.com/api/mcp") out(`Server: ${config.server}`);
    return 0;
  }
  if (cmd === "logout") {
    store.clearConfig();
    out("Signed out on this computer. To stop every assistant and key, use Settings > Assistants > Disconnect.");
    return 0;
  }
  if (cmd === "pending") {
    const all = store.listPending();
    const rows = Object.entries(all).map(([id, e]) => ({ id, action: e.tool, platform: e.args.platform, expires: e.expires_at, text: e.args.content.slice(0, 60) }));
    if (flags.json) out(JSON.stringify(rows, null, 2));
    else out(rows.length ? formatValue(rows) : "Nothing waiting for confirmation.");
    return 0;
  }

  if (cmd === "publish" || cmd === "schedule") {
    const [tool, toolArgs] = postArgs(cmd, args, flags, io);
    const res = await callTool(tool, toolArgs, { store, env });
    const d = res.data ?? {};
    if (res.isError || d.status !== "confirm_required" || !d.confirmation_token) {
      if (res.isError) err(res.text);
      else show(res);
      return res.isError ? 1 : 0;
    }
    const pinned = { ...toolArgs, account_id: toolArgs.account_id ?? d.account?.id };
    const id = store.addPending({ tool, args: pinned, token: d.confirmation_token, expires_at: d.expires_at });
    if (flags.json) {
      out(JSON.stringify({ status: "confirm_required", confirm_id: id, platform: d.platform, account: d.account?.name, content: d.content, scheduled_for: d.scheduled_for ?? toolArgs.scheduled_for, expires_at: d.expires_at }, null, 2));
    } else {
      out(`Preview (${d.platform} as ${d.account?.name ?? "your account"}${toolArgs.scheduled_for ? `, for ${toolArgs.scheduled_for}` : ""}):`);
      out("");
      out(d.content ?? toolArgs.content);
      out("");
      out(`Nothing has been posted. To ${cmd} it exactly as shown: voicemoat confirm ${id}`);
      out(`This preview expires at ${d.expires_at}.`);
    }
    return 0;
  }

  if (cmd === "confirm") {
    const id = need(args[0], "give the id from the preview: voicemoat confirm <id>");
    const entry = store.takePending(id);
    if (!entry) throw new Error(`no preview "${id}" waiting (it may have expired). Run publish or schedule again.`);
    const res = await callTool(entry.tool, { ...entry.args, confirmation_token: entry.token }, { store, env });
    if (res.isError) {
      err(res.text);
      return 1;
    }
    show(res);
    return 0;
  }

  const build = READ[cmd];
  if (!build) {
    err(`unknown command "${cmd}". Run: voicemoat --help`);
    return 2;
  }
  const [tool, toolArgs] = build(args, flags, io);
  const res = await callTool(tool, toolArgs, { store, env });
  if (res.isError) {
    err(res.text);
    return 1;
  }
  show(res);
  return 0;
}

export { serverUrl };
