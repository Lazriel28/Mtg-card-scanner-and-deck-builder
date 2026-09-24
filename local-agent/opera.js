import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "./log.js";

const DEFAULT_PREFERENCES = {
  oauth_client_ids: [],
  oauth_revoke_urls: [],
};

export function findLoginFile(profileDir) {
  if (!profileDir) return null;
  const candidates = [
    path.join(profileDir, "Login Data"),
    path.join(profileDir, "LoginData"),
    path.join(profileDir, "Default", "Login Data"),
    path.join(profileDir, "Default", "LoginData"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function findPreferencesFile(profileDir) {
  if (!profileDir) return null;
  const candidates = [
    path.join(profileDir, "Preferences"),
    path.join(profileDir, "Network", "Preferences"),
    path.join(profileDir, "Default", "Preferences"),
    path.join(profileDir, "Default", "Network", "Preferences"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function openSSlDecrypt(encrypted, key) {
  try {
    const decipher = crypto.createDecipher("aes-128-ecb", key);
    let decrypted = decipher.update(encrypted, "base64");
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    throw new Error("Opera password decryption failed: " + error.message);
  }
}

function readPreferences(profileDir) {
  const prefsPath = findPreferencesFile(profileDir);
  if (!prefsPath) return DEFAULT_PREFERENCES;

  try {
    const raw = fs.readFileSync(prefsPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.oauth_client_ids ?? DEFAULT_PREFERENCES.oauth_client_ids
      ? parsed
      : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function deriveKeyFromPreferences(prefs) {
  if (!prefs.oauth_client_ids || prefs.oauth_client_ids.length === 0) {
    return null;
  }

  const value = prefs.oauth_client_ids[0];
  const sha1 = crypto.createHash("sha1");
  sha1.update(value, "utf8");
  return sha1.digest();
}

export async function readOperaLogins(profileDir) {
  const loginPath = findLoginFile(profileDir);
  if (!loginPath) {
    throw new Error(
      "Opera GX Login Data file not found. Set OPERA_PROFILE_DIR to your profile folder."
    );
  }

  const prefs = readPreferences(profileDir);
  const key = deriveKeyFromPreferences(prefs);
  if (!key) {
    throw new Error(
      "Could not derive an Opera password key from Preferences. The OAuth client id list was empty or unreadable."
    );
  }

  logger.info("Reading Opera logins from:", loginPath);

  if (process.platform === "win32") {
    return readLoginDataSqliteWindows(loginPath, key);
  }

  throw new Error(
    "This tool currently supports Opera GX password reading on Windows. " +
      "Your platform is " +
      process.platform +
      ". File a follow-up and I will add support."
  );
}

function readLoginDataSqliteWindows(loginPath, key) {
  try {
    const betterSqlite = require("better-sqlite3");
    const db = betterSqlite("file:" + loginPath + "?mode=ro", { readonly: true });
    const rows = db.prepare(
      "SELECT origin_url, username_value, password_value FROM logins ORDER BY origin_url"
    ).all();
    db.close();

    const results = [];

    for (const row of rows) {
      if (!row.password_value) continue;
      const encrypted = typeof row.password_value === "string"
        ? row.password_value
        : Buffer.from(row.password_value).toString("base64");

      let password = "";
      try {
        password = openSSlDecrypt(encrypted.split(",")[1] || encrypted, Buffer.from(key)).trim();
      } catch {
        password = "<decryption-failed>";
      }

      results.push({
        origin: row.origin_url,
        username: row.username_value,
        password,
      });
    }

    return results;
  } catch (error) {
    const message = error.message || String(error);
    if (message.includes("Cannot find module") || message.includes("better-sqlite3")) {
      throw new Error(
        "Opera login reading requires the 'better-sqlite3' package on Windows. " +
          "Run: npm install better-sqlite3"
      );
    }
    throw new Error("Failed to read Opera Login Data: " + message);
  }
}

export function findCredential(profileDir, match) {
  const logins = readOperaLogins(profileDir);
  const lower = match.toLowerCase();
  return logins.find((item) =>
    item.origin.toLowerCase().includes(lower) ||
    item.username.toLowerCase().includes(lower)
  );
}
