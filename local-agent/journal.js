import fs from "node:fs";
import path from "node:path";
import { logger } from "./log.js";

export function readJournal(journalPath) {
  if (!journalPath) return "";

  const resolved = path.resolve(journalPath);
  if (!fs.existsSync(resolved)) {
    logger.info("No journal file found yet at:", resolved);
    return "";
  }

  return fs.readFileSync(resolved, "utf8");
}

export function appendJournal(journalPath, entry) {
  const resolved = path.resolve(journalPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(resolved, entry + "\n");
  logger.info("Appended journal entry to:", resolved);
}

export function ensureJournalFile(journalPath) {
  const resolved = path.resolve(journalPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, "", "utf8");
    logger.info("Created empty journal file at:", resolved);
  }
  return resolved;
}
