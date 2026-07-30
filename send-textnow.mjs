#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  formatRemainingTime,
  loadConfig,
  shouldAllowSend,
} from "./src/lib.mjs";

const PROJECT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = path.join(os.homedir(), ".textnow-safe-autosend");
const PROFILE_DIRECTORY = path.join(APP_DIRECTORY, "chrome-profile");
const LOG_DIRECTORY = path.join(APP_DIRECTORY, "logs");
const STATE_PATH = path.join(APP_DIRECTORY, "state.json");
const MESSAGING_URL = "https://www.textnow.com/messaging";

function hasFlag(name) {
  return process.argv.includes(name);
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
  ].filter(Boolean);

  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Google Chrome was not found. Install Chrome or set CHROME_PATH to its executable.",
    );
  }
  return executable;
}

function ensureDirectories() {
  fs.mkdirSync(PROFILE_DIRECTORY, { recursive: true });
  fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

function cleanupOldLogs() {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(LOG_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(LOG_DIRECTORY, entry.name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {
      // Log cleanup should never block message sending.
    }
  }
}

async function launchBrowser({ headed }) {
  return chromium.launchPersistentContext(PROFILE_DIRECTORY, {
    executablePath: findChromeExecutable(),
    channel: undefined,
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
}

async function pageShowsCaptcha(page) {
  const captchaText = page.getByText(
    /verify you are human|press and hold|captcha/i,
  );
  return captchaText
    .first()
    .isVisible()
    .catch(() => false);
}

async function pageRequiresLogin(page) {
  if (/\/login(?:[/?#]|$)/i.test(page.url())) return true;

  const passwordField = page.locator('input[type="password"]');
  return passwordField
    .first()
    .isVisible()
    .catch(() => false);
}

async function firstVisible(candidates, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const locator = candidate.first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return null;
}

async function setupLogin() {
  ensureDirectories();
  const context = await launchBrowser({ headed: true });
  const page = context.pages()[0] ?? (await context.newPage());

  console.log("Opening TextNow in Chrome...");
  await page.goto(MESSAGING_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  console.log(
    "Log in normally in the Chrome window. Complete any verification yourself.",
  );
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await prompt.question(
    "After the TextNow messaging page is fully open, press Enter here...",
  );
  prompt.close();

  if (await pageRequiresLogin(page)) {
    await context.close();
    throw new Error("TextNow still appears to be logged out. Run setup again.");
  }

  await context.close();
  console.log("Local login profile saved. No password was written to this project.");
}

async function selectRecipient(page, recipient) {
  const newMessageButton = await firstVisible([
    page.getByRole("button", {
      name: /new (message|conversation)|compose/i,
    }),
    page.locator('button[aria-label*="new message" i]'),
    page.locator('button[title*="new message" i]'),
    page.locator('[data-testid*="new-message" i]'),
  ]);

  if (newMessageButton) {
    await newMessageButton.click();
  }

  const recipientInput = await firstVisible([
    page.locator('input[aria-label*="recipient" i]'),
    page.locator('input[placeholder*="phone number" i]'),
    page.locator('input[placeholder*="name or number" i]'),
    page.locator('input[placeholder^="to" i]'),
    page.locator('[data-testid*="recipient" i] input'),
  ]);

  if (!recipientInput) {
    throw new Error(
      "Could not find the recipient field. TextNow may have changed its page layout.",
    );
  }

  await recipientInput.fill(recipient);
  await page.waitForTimeout(800);

  const matchingSuggestion = await firstVisible(
    [
      page.getByRole("option", { name: new RegExp(recipient.slice(-4)) }),
      page.getByRole("listitem", { name: new RegExp(recipient.slice(-4)) }),
      page.locator('[data-testid*="contact-result" i]'),
    ],
    2_500,
  );

  if (matchingSuggestion) {
    await matchingSuggestion.click();
  } else {
    await recipientInput.press("Enter");
  }
}

async function fillMessage(locator, message) {
  const tagName = await locator.evaluate((element) =>
    element.tagName.toLowerCase(),
  );

  if (tagName === "textarea" || tagName === "input") {
    await locator.fill(message);
    return;
  }

  await locator.click();
  await locator.pressSequentially(message, { delay: 8 });
}

async function sendMessage(page, message) {
  const messageInput = await firstVisible([
    page.locator('textarea[aria-label*="message" i]'),
    page.locator('textarea[placeholder*="message" i]'),
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[data-testid*="message-input" i]'),
  ]);

  if (!messageInput) {
    throw new Error(
      "Could not find the message box. TextNow may have changed its page layout.",
    );
  }

  await fillMessage(messageInput, message);

  const sendButton = await firstVisible(
    [
      page.getByRole("button", { name: /^send(?: message)?$/i }),
      page.locator('button[aria-label*="send" i]'),
      page.locator('[data-testid*="send-button" i]'),
    ],
    5_000,
  );

  if (sendButton) {
    await sendButton.click();
  } else {
    await messageInput.press("Enter");
  }

  await page.waitForTimeout(2_500);

  const visibleError = await firstVisible(
    [
      page.getByText(/message (?:was )?not sent|failed to send|unable to send/i),
      page.getByRole("alert").filter({
        hasText: /failed|not sent|unable|try again/i,
      }),
    ],
    1_500,
  );
  if (visibleError) {
    throw new Error(
      `TextNow reported a send failure: ${(await visibleError.textContent())?.trim() || "unknown error"}`,
    );
  }

  const remainingText = await messageInput
    .evaluate((element) => {
      if ("value" in element) return element.value;
      return element.textContent ?? "";
    })
    .catch(() => "");

  if (remainingText.trim() === message.trim()) {
    throw new Error(
      "The message remained in the composer, so TextNow did not confirm that it was sent.",
    );
  }
}

async function runSend() {
  ensureDirectories();
  cleanupOldLogs();

  const config = loadConfig(PROJECT_DIRECTORY);
  const force = hasFlag("--force");
  const state = readState();
  const permission = shouldAllowSend({
    lastSentAt: state.lastSentAt,
    minimumDaysBetweenMessages: config.minimumDaysBetweenMessages,
    force,
  });

  if (!permission.allowed) {
    console.log(
      `Skipped: the last successful send was too recent. Try again in ${formatRemainingTime(
        permission.remainingMs,
      )}.`,
    );
    return;
  }

  const headed = hasFlag("--headed");
  const context = await launchBrowser({ headed });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(MESSAGING_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2_000);

    if (await pageShowsCaptcha(page)) {
      throw new Error(
        "TextNow requested human verification. Run `npm run setup-login` and complete it manually; this script will not bypass CAPTCHA.",
      );
    }

    if (await pageRequiresLogin(page)) {
      throw new Error(
        "The saved TextNow session has expired. Run `npm run setup-login` again.",
      );
    }

    await selectRecipient(page, config.recipient);
    await sendMessage(page, config.message);

    writeState({
      lastSentAt: new Date().toISOString(),
      recipientLast4: config.recipient.slice(-4),
    });
    console.log(`Message sent successfully to ***${config.recipient.slice(-4)}.`);
  } catch (error) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(
      LOG_DIRECTORY,
      `error-${timestamp}.png`,
    );
    await page
      .screenshot({ path: screenshotPath, fullPage: false })
      .catch(() => {});
    throw new Error(
      `${error.message}\nA diagnostic screenshot was saved locally at ${screenshotPath}.`,
    );
  } finally {
    await context.close();
  }
}

try {
  if (hasFlag("--setup")) {
    await setupLogin();
  } else {
    await runSend();
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
}
