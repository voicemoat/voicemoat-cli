// Sign-in for the CLI: OAuth 2.1 authorization code + PKCE with a loopback
// redirect (RFC 8252). The browser goes through VoiceMoat's normal sign-in and
// Approve screen, the same path Claude and ChatGPT use. Servers and agents can
// skip this and set VOICEMOAT_API_KEY to a personal key instead.
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const DEFAULT_SERVER = "https://app.voicemoat.com/api/mcp";
export const LOOPBACK_PORTS = [53682, 53683, 53684, 53685, 53686];
const SCOPE = "openid profile email offline_access";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function serverUrl(env = process.env) {
  return (env.VOICEMOAT_URL || DEFAULT_SERVER).replace(/\/+$/, "");
}

/** Protected resource metadata, then the authorization server's metadata. */
export async function discover(resource, fetchImpl = fetch) {
  const u = new URL(resource);
  const prmUrl = `${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`;
  const prm = await (await fetchImpl(prmUrl)).json();
  const issuer = prm.authorization_servers?.[0];
  if (!issuer) throw new Error("the server did not say where to sign in");
  const meta = await (await fetchImpl(`${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`)).json();
  if (!meta.authorization_endpoint || !meta.token_endpoint) throw new Error("sign-in server metadata is incomplete");
  return { resource: prm.resource || resource, issuer: meta.issuer || issuer, meta };
}

async function registerClient(meta, fetchImpl = fetch) {
  if (!meta.registration_endpoint) throw new Error("the sign-in server does not allow client registration");
  const res = await fetchImpl(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "VoiceMoat CLI",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      redirect_uris: LOOPBACK_PORTS.map((p) => `http://127.0.0.1:${p}/callback`),
    }),
  });
  const json = await res.json();
  if (!json.client_id) throw new Error(`could not register the CLI (${res.status})`);
  return json.client_id;
}

function listenOnFreePort(handler) {
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= LOOPBACK_PORTS.length) return reject(new Error(`ports ${LOOPBACK_PORTS.join(", ")} are all busy`));
      const server = http.createServer(handler);
      server.once("error", () => tryPort(i + 1));
      server.listen(LOOPBACK_PORTS[i], "127.0.0.1", () => resolve({ server, port: LOOPBACK_PORTS[i] }));
    };
    tryPort(0);
  });
}

export function openBrowser(url, platform = process.platform) {
  // No shell: the URL is passed as one argument, so & and ? are safe.
  const [cmd, args] =
    platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

async function tokenRequest(meta, body, fetchImpl = fetch) {
  const res = await fetchImpl(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) {
    const why = json.error_description || json.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(`sign-in failed: ${why}`), { code: json.error });
  }
  return json;
}

function withExpiry(tokens, now = Date.now()) {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expires_at: new Date(now + (Number(tokens.expires_in) || 600) * 1000).toISOString(),
  };
}

/** Full browser sign-in. Returns the config to save. */
export async function login({ store, env = process.env, log = console.error, open = openBrowser, timeoutMs = 5 * 60 * 1000 }) {
  const resource = serverUrl(env);
  const { issuer, meta } = await discover(resource);
  const config = store.readConfig();
  let clientId = config.issuer === issuer && config.server === resource ? config.client_id : null;
  if (!clientId) clientId = await registerClient(meta);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  let finish;
  const done = new Promise((resolve, reject) => (finish = { resolve, reject }));
  const { server, port } = await listenOnFreePort((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ok ? "<p>VoiceMoat CLI is signed in. You can close this tab.</p>" : "<p>VoiceMoat CLI sign-in did not finish. Go back to your terminal.</p>");
    if (url.searchParams.get("state") !== state) finish.reject(new Error("sign-in state did not match; try again"));
    else if (!url.searchParams.get("code")) finish.reject(new Error(`sign-in was not approved (${url.searchParams.get("error") ?? "no code"})`));
    else finish.resolve(url.searchParams.get("code"));
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const auth = new URL(meta.authorization_endpoint);
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource,
  }).toString();

  log("Opening your browser to sign in to VoiceMoat. If it does not open, visit:");
  log(auth.toString());
  open(auth.toString());

  const timer = setTimeout(() => finish.reject(new Error("timed out waiting for the browser sign-in")), timeoutMs);
  try {
    const code = await done;
    const tokens = await tokenRequest(meta, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
    const next = { server: resource, issuer, client_id: clientId, token_endpoint: meta.token_endpoint, ...withExpiry(tokens) };
    store.writeConfig(next);
    return next;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/** A bearer token for the next call: the API key, or a fresh OAuth token. */
export async function bearer({ store, env = process.env, force = false, now = Date.now(), fetchImpl = fetch }) {
  if (env.VOICEMOAT_API_KEY) return { token: env.VOICEMOAT_API_KEY.trim(), kind: "key" };
  const config = store.readConfig();
  if (!config.access_token) throw new Error("not signed in. Run: voicemoat login (or set VOICEMOAT_API_KEY)");
  if (config.server && config.server !== serverUrl(env)) {
    throw new Error(`signed in to ${config.server}, not ${serverUrl(env)}. Run: voicemoat login`);
  }
  const fresh = !force && Date.parse(config.expires_at ?? 0) - now > 30_000;
  if (fresh) return { token: config.access_token, kind: "oauth" };
  if (!config.refresh_token || !config.token_endpoint) throw new Error("your sign-in expired. Run: voicemoat login");
  let tokens;
  try {
    tokens = await tokenRequest({ token_endpoint: config.token_endpoint }, {
      grant_type: "refresh_token",
      refresh_token: config.refresh_token,
      client_id: config.client_id,
      resource: config.server,
    }, fetchImpl);
  } catch {
    throw new Error("your sign-in expired. Run: voicemoat login");
  }
  const next = { ...config, ...withExpiry(tokens, now), refresh_token: tokens.refresh_token ?? config.refresh_token };
  store.writeConfig(next);
  return { token: next.access_token, kind: "oauth" };
}
