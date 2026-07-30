import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MINIMUM_DAYS = 6;

export function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new Error(
    "Recipient must be a valid 10-digit US/Canada number, for example +15551234567.",
  );
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config.json must contain a JSON object.");
  }

  const recipient = normalizePhoneNumber(config.recipient);
  const message = String(config.message ?? "").trim();
  const minimumDaysBetweenMessages = Number(
    config.minimumDaysBetweenMessages ?? DEFAULT_MINIMUM_DAYS,
  );

  if (!message) {
    throw new Error("The message in config.json cannot be empty.");
  }

  if (message.length > 500) {
    throw new Error("The message must be 500 characters or fewer.");
  }

  if (
    !Number.isFinite(minimumDaysBetweenMessages) ||
    minimumDaysBetweenMessages < 1 ||
    minimumDaysBetweenMessages > 31
  ) {
    throw new Error("minimumDaysBetweenMessages must be between 1 and 31.");
  }

  return {
    recipient,
    message,
    minimumDaysBetweenMessages,
  };
}

export function loadConfig(projectDirectory) {
  const configPath = path.join(projectDirectory, "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing ${configPath}. Copy config.example.json to config.json and edit it first.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read config.json: ${error.message}`);
  }

  return validateConfig(parsed);
}

export function shouldAllowSend({
  lastSentAt,
  now = new Date(),
  minimumDaysBetweenMessages = DEFAULT_MINIMUM_DAYS,
  force = false,
}) {
  if (force || !lastSentAt) {
    return { allowed: true, remainingMs: 0 };
  }

  const previous = new Date(lastSentAt);
  if (Number.isNaN(previous.getTime())) {
    return { allowed: true, remainingMs: 0 };
  }

  const minimumMs = minimumDaysBetweenMessages * 24 * 60 * 60 * 1000;
  const elapsedMs = now.getTime() - previous.getTime();
  const remainingMs = Math.max(0, minimumMs - elapsedMs);

  return {
    allowed: remainingMs === 0,
    remainingMs,
  };
}

export function formatRemainingTime(milliseconds) {
  const totalHours = Math.ceil(milliseconds / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${days} day${days === 1 ? "" : "s"} ${hours} hour${
    hours === 1 ? "" : "s"
  }`;
}
