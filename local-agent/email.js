import nodemailer from "nodemailer";
import { logger } from "./log.js";

let transporter = null;

function makeTransporter(config) {
  if (!config.from || !config.user) {
    throw new Error("Email not configured: EMAIL_FROM and EMAIL_USER are required.");
  }

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.tls ? false : false,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: config.tls ? { rejectUnauthorized: false } : undefined,
  });

  return transporter;
}

export async function sendEmail({ to, subject, text, html, config }) {
  const transport = makeTransporter(config);

  const message = {
    from: config.from,
    to: to || config.from,
    subject: subject || "(no subject)",
    text: text || "",
    html: html || "<p>" + (text || "") + "</p>",
  };

  logger.info("Sending email:", message.subject, "to:", message.to);

  const result = await transport.sendMail(message);
  logger.info("Email sent. Message ID:", result.messageId);
  return result;
}

export function emailConfigComplete(config) {
  return !!(config.enabled && config.from && config.user && config.pass);
}
