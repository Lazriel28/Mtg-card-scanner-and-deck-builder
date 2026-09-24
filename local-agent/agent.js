import { draft, sanitizeText } from "./ai.js";
import { sendEmail, emailConfigComplete } from "./email.js";
import { publishCopy, publishPhoto, publishLocalPhoto, instagramConfigComplete } from "./instagram.js";
import { readJournal } from "./journal.js";
import { logger } from "./log.js";

const SYSTEM_PROMPT = `You are a book-promotion assistant.

You help a writer draft short updates about their book for email and social
posting. You write in a clear, human voice. You do not invent facts; if you do
not have enough context, you ask for it instead of guessing. Keep drafts short
unless asked otherwise. Do not include any private information in the draft.`;

function buildUserContext(action, opts, journal) {
  let user = `Action: ${action}\n\n`;
  if (opts.subject) user += `Subject: ${opts.subject}\n`;
  if (opts.text) user += `Notes: ${opts.text}\n`;
  if (journal && journal.trim()) user += `\nRecent context to consider:\n${journal}`;
  if (!opts.subject && !opts.text && !journal.trim()) {
    user += "\nNo specific notes were provided. Draft a short, useful update about the book.";
  }
  return user;
}

export async function runAgent(action, config) {
  logger.info("Running action:", action);

  if (action === "status") {
    return printStatus(config);
  }

  if (action === "draft") {
    return draftContent(config);
  }

  if (action === "email") {
    return runEmailAction(config);
  }

  if (action === "instagram") {
    return runInstagramAction(config);
  }

  throw new Error("Unknown action: " + action);
}

async function draftContent(config) {
  const journal = readJournal(config.journal.path);
  const system = SYSTEM_PROMPT;
  const user = buildUserContext("draft", {}, journal);

  logger.info("Asking local AI for a draft...");
  const text = await draft({ ai: config.ai, system, user });
  logger.info("Draft:\n" + text);
  return text;
}

async function runEmailAction(config) {
  if (!emailConfigComplete(config)) {
    throw new Error(
      "Email is not configured. Set EMAIL_FROM, EMAIL_USER, and EMAIL_PASS, or disable it with EMAIL_ENABLED=false."
    );
  }

  const journal = readJournal(config.journal.path);
  const text = await draft({
    ai: config.ai,
    system: SYSTEM_PROMPT + "\n\nWrite the email body only. Do not include subject lines.",
    user: buildUserContext("email", {}, journal),
  });

  const subject = await draft({
    ai: config.ai,
    system: "You provide short email subject lines only.",
    user: "Provide a short subject line for an email about the book.",
  });

  logger.info("Sending email with subject:", subject);
  const result = await sendEmail({ subject, text, config });
  logger.info("Email sent.");
  return result;
}

async function runInstagramAction(config) {
  if (!instagramConfigComplete(config)) {
    throw new Error(
      "Instagram publishing is not configured. Set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN with a publishing-scoped token for the target account."
    );
  }

  const journal = readJournal(config.journal.path);
  const copy = await draft({
    ai: config.ai,
    system: SYSTEM_PROMPT + "\n\nWrite the Instagram post copy only. Do not include hashtags unless the user asked for them.",
    user: buildUserContext("instagram", {}, journal),
  });

  logger.info("Publishing Instagram copy...");
  const result = await publishCopy({ copy, config });
  logger.info("Instagram publish result received.");
  return result;
}

async function printStatus(config) {
  logger.info("Local agent status");
  logger.info("  AI endpoint:", config.ai.url, "model:", config.ai.model);
  logger.info("  Email enabled:", config.email.enabled, "complete:", emailConfigComplete(config));
  logger.info("  Instagram enabled:", config.instagram.enabled, "complete:", instagramConfigComplete(config));
  logger.info("  Opera profile dir:", config.opera.profileDir);
  logger.info("  Journal file:", config.journal.path);

  if (config.opera.profileDir) {
    try {
      const { findLoginFile, findPreferencesFile } = await import("./opera.js");
      const loginFile = findLoginFile(config.opera.profileDir);
      const prefsFile = findPreferencesFile(config.opera.profileDir);
      logger.info("  Opera Login Data:", loginFile || "not found");
      logger.info("  Opera Preferences:", prefsFile || "not found");

      if (loginFile && prefsFile) {
        const { readOperaLogins } = await import("./opera.js");
        const logins = readOperaLogins(config.opera.profileDir);
        logger.info("  Opera logins found:", logins.length);
        for (const item of logins.slice(0, 5)) {
          logger.info("    -", item.origin, "username:", item.username);
        }
        if (logins.length > 5) logger.info("    ... and", logins.length - 5, "more");
      } else {
        logger.warn("  Opera login reading skipped: this Opera GX install did not expose Login Data/Preferences at the expected path.");
        logger.warn("  You can still use email and Instagram with credentials you set directly.");
      }
    } catch (error) {
      logger.warn("    Opera login probe failed:", error.message);
    }
  }

  return {
    ai: config.ai,
    email: config.email,
    instagram: config.instagram,
    opera: config.opera,
    journal: config.journal.path,
  };
}
