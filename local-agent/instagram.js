import { logger } from "./log.js";

export function instagramConfigComplete(config) {
  return !!(config.enabled && config.baseUrl && config.accountId && config.accessToken);
}

export async function publishPhoto({ imageUrl, caption, config }) {
  if (!instagramConfigComplete(config)) {
    throw new Error(
      "Instagram publishing is not fully configured. " +
        "Set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN, and make sure your Facebook/Instagram app has the publishing scopes for that account."
    );
  }

  const postUrl = `${config.baseUrl}/${config.accountId}/media`;
  const body = new URLSearchParams({
    image_url: imageUrl,
    caption: (caption || "").trim(),
    access_token: config.accessToken,
  });

  logger.info("Requesting Instagram photo publish for account:", config.accountId);

  const response = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Instagram publish request failed: ${response.status} ${raw.slice(0, 500)}`);
  }

  const json = await response.json();
  const creationId = json.id;

  if (!creationId) {
    throw new Error("Instagram create-media response did not include an id.");
  }

  return waitForPublish({ creationId, config });
}

export async function publishCopy({ copy, config }) {
  if (!instagramConfigComplete(config)) {
    throw new Error(
      "Instagram publishing is not fully configured. " +
        "Set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN, and make sure your Facebook/Instagram app has the publishing scopes for that account."
    );
  }

  const postUrl = `${config.baseUrl}/${config.accountId}/media`;
  const body = new URLSearchParams({
    caption: (copy || "").trim(),
    access_token: config.accessToken,
  });

  logger.info("Requesting Instagram text publish for account:", config.accountId);

  const response = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Instagram publish request failed: ${response.status} ${raw.slice(0, 500)}`);
  }

  const json = await response.json();
  const creationId = json.id;

  if (!creationId) {
    throw new Error("Instagram create-media response did not include an id.");
  }

  return waitForPublish({ creationId, config });
}

async function waitForPublish({ creationId, config }) {
  const statusUrl = `${config.baseUrl}/${config.accountId}/media_publish`;
  const body = new URLSearchParams({
    creation_id: creationId,
    access_token: config.accessToken,
  });

  logger.info("Waiting for Instagram publish to complete for creation:", creationId);

  const response = await fetch(statusUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Instagram publish status request failed: ${response.status} ${raw.slice(0, 500)}`);
  }

  const json = await response.json();
  logger.info("Instagram publish result:", JSON.stringify(json));
  return json;
}

export async function publishLocalPhoto({ imagePath, caption, config }) {
  if (!instagramConfigComplete(config)) {
    throw new Error(
      "Instagram publishing is not fully configured. " +
        "Set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN, and make sure your Facebook/Instagram app has the publishing scopes for that account."
    );
  }

  const imageUrl = await uploadLocalPhoto(imagePath, config);
  return publishPhoto({ imageUrl, caption, config });
}

async function uploadLocalPhoto(imagePath, config) {
  if (!config.uploadEndpoint) {
    throw new Error(
      "To publish a local photo, set INSTAGRAM_UPLOAD_ENDPOINT to a URL that accepts an image and returns a public URL suitable for Instagram's image_url field."
    );
  }

  logger.info("Uploading local photo to:", config.uploadEndpoint);

  const response = await fetch(config.uploadEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await fsRead(imagePath),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Local photo upload failed: ${response.status} ${raw.slice(0, 500)}`);
  }

  const json = await response.json();
  return json.url;
}

async function fsRead(filePath) {
  const fs = await import("node:fs");
  return fs.readFileSync(filePath);
}
