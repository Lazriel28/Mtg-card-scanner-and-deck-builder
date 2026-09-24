import { logger } from "./log.js";

export function sanitizeText(text) {
  return String(text).trim();
}

export async function draft({ ai, system, user }) {
  const url = ai.url;
  const model = ai.model;
  const timeoutMs = ai.timeoutMs;

  if (!url) {
    throw new Error("No AI endpoint configured. Set AI_URL to a local OpenAI-compatible server.");
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
    max_tokens: 1024,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`AI endpoint returned ${response.status}: ${raw.slice(0, 400)}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error("AI response did not include a message.");
    }
    return sanitizeText(choice.message.content);
  } catch (error) {
    clearTimeout(timer);
    if (error.name === "AbortError") {
      throw new Error(`AI request timed out after ${timeoutMs}ms.`);
    }
    const message = error.message ? String(error.message) : String(error);
    if (message.includes("fetch failed") || message.includes("ECONNREFUSED") || message.includes("ERR_CONNECTION_REFUSED")) {
      throw new Error(`AI endpoint is not reachable at ${url}. Start a local OpenAI-compatible server first.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
