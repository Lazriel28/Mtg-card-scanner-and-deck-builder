import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./log.js";

const CONFIG_FILE = path.join(process.cwd(), "config.json");

function firstExisting(...candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function discoverOperaProfileDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "Library", "Opera", "User Data"),
    path.join(home, "Library", "Opera GX", "User Data"),
    path.join(home, "Opera", "User Data"),
    path.join(process.env.PROGRAMDATA || "", "Opera Software", "Opera Stable"),
    path.join(process.env.LOCALAPPDATA || "", "Opera Software", "Opera Stable"),
    path.join(process.env.LOCALAPPDATA || "", "Opera Software", "Opera GX Stable"),
  ];
  return firstExisting(...candidates);
}

export function loadConfig() {
  const fileConfig = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
    : {};

  const config = {
    ai: {
      url: process.env.AI_URL || fileConfig.ai?.url || "http://127.0.0.1:11434/v1",
      model: process.env.AI_MODEL || fileConfig.ai?.model || "local",
      timeoutMs: Number(process.env.AI_TIMEOUT_MS || fileConfig.ai?.timeoutMs || 60000),
    },
    email: {
      enabled: process.env.EMAIL_ENABLED !== "false" && fileConfig.email?.enabled !== false,
      smtpHost: process.env.SMTP_HOST || fileConfig.email?.smtpHost || "smtp.gmail.com",
      smtpPort: Number(process.env.SMTP_PORT || fileConfig.email?.smtpPort || 587),
      from: process.env.EMAIL_FROM || fileConfig.email?.from,
      user: process.env.EMAIL_USER || fileConfig.email?.user,
      pass: process.env.EMAIL_PASS || fileConfig.email?.pass,
      tls: process.env.EMAIL_TLS !== "false" && fileConfig.email?.tls !== false,
    },
    instagram: {
      enabled: process.env.INSTAGRAM_ENABLED !== "false" && fileConfig.instagram?.enabled !== false,
      baseUrl: process.env.INSTAGRAM_BASE_URL || fileConfig.instagram?.baseUrl || "https://graph.facebook.com/v18.0",
      accountId: process.env.INSTAGRAM_ACCOUNT_ID || fileConfig.instagram?.accountId,
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || fileConfig.instagram?.accessToken,
    },
    opera: {
      profileDir: process.env.OPERA_PROFILE_DIR || fileConfig.opera?.profileDir || discoverOperaProfileDir(),
    },
    journal: {
      path: process.env.JOURNAL_PATH || fileConfig.journal?.path || path.join(process.cwd(), "journal.txt"),
    },
    logPath: process.env.LOG_PATH || fileConfig.logPath || path.join(process.cwd(), "agent.log"),
  };

  if (!config.email.from || !config.email.user) {
    logger.warn("Email is not fully configured. Set EMAIL_FROM and EMAIL_USER.");
  }
  if (!config.instagram.accountId || !config.instagram.accessToken) {
    logger.warn(
      "Instagram is not fully configured. Set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN."
    );
  }
  if (!config.opera.profileDir) {
    logger.warn("Opera GX profile directory not found. Set OPERA_PROFILE_DIR explicitly.");
  }

  return config;
}
