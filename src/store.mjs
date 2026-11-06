// Local state: ~/.voicemoat (or $VOICEMOAT_HOME). Files are written with
// mode 0600 because they hold OAuth tokens and one-time posting codes.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export function homeDir(env = process.env) {
  return env.VOICEMOAT_HOME || join(homedir(), ".voicemoat");
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file still lives in the user's profile.
  }
}

export function createStore(dir = homeDir()) {
  const configPath = join(dir, "config.json");
  const pendingPath = join(dir, "pending.json");
  const ensure = () => mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    dir,
    readConfig: () => readJson(configPath) ?? {},
    writeConfig(config) {
      ensure();
      writeJson(configPath, config);
    },
    clearConfig() {
      rmSync(configPath, { force: true });
      rmSync(pendingPath, { force: true });
    },
    /** Saves a posting preview so `voicemoat confirm <id>` can finish it. */
    addPending(entry, now = Date.now()) {
      ensure();
      const all = this.listPending(now);
      let id;
      do id = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      while (all[id]);
      all[id] = entry;
      writeJson(pendingPath, all);
      return id;
    },
    listPending(now = Date.now()) {
      const all = readJson(pendingPath) ?? {};
      for (const [id, e] of Object.entries(all)) {
        if (!e?.expires_at || Date.parse(e.expires_at) <= now) delete all[id];
      }
      return all;
    },
    takePending(id, now = Date.now()) {
      const all = this.listPending(now);
      const key = String(id).toUpperCase();
      const entry = all[key] ?? null;
      if (entry) {
        delete all[key];
        ensure();
        writeJson(pendingPath, all);
      }
      return entry;
    },
  };
}
