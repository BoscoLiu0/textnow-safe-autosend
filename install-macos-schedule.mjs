#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABEL = "com.bosco.textnow-safe-autosend";
const PROJECT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const LAUNCH_AGENTS_DIRECTORY = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
);
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIRECTORY, `${LABEL}.plist`);
const LOG_DIRECTORY = path.join(os.homedir(), ".textnow-safe-autosend", "logs");

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function parseInteger(name, fallback, minimum, maximum) {
  const value = Number(argumentValue(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bootoutExisting() {
  spawnSync("launchctl", [
    "bootout",
    `gui/${process.getuid()}`,
    PLIST_PATH,
  ]);
}

function uninstall() {
  bootoutExisting();
  if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
  console.log(`Removed weekly schedule: ${PLIST_PATH}`);
}

function install() {
  if (process.platform !== "darwin") {
    throw new Error("This scheduler installer is for macOS only.");
  }

  const weekday = parseInteger("--weekday", "1", 0, 7);
  const hour = parseInteger("--hour", "19", 0, 23);
  const minute = parseInteger("--minute", "30", 0, 59);
  const scriptPath = path.join(PROJECT_DIRECTORY, "send-textnow.mjs");

  fs.mkdirSync(LAUNCH_AGENTS_DIRECTORY, { recursive: true });
  fs.mkdirSync(LOG_DIRECTORY, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(PROJECT_DIRECTORY)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>${weekday}</integer>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(LOG_DIRECTORY, "schedule.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(LOG_DIRECTORY, "schedule-error.log"))}</string>
</dict>
</plist>
`;

  fs.writeFileSync(PLIST_PATH, plist, { mode: 0o600 });
  bootoutExisting();
  const result = spawnSync("launchctl", [
    "bootstrap",
    `gui/${process.getuid()}`,
    PLIST_PATH,
  ]);

  if (result.status !== 0) {
    throw new Error(
      `launchctl could not load the schedule: ${result.stderr?.toString() || "unknown error"}`,
    );
  }

  console.log(
    `Installed weekly schedule (weekday ${weekday}, ${String(hour).padStart(
      2,
      "0",
    )}:${String(minute).padStart(2, "0")}).`,
  );
  console.log(`Schedule file: ${PLIST_PATH}`);
}

try {
  if (process.argv.includes("--uninstall")) {
    uninstall();
  } else {
    install();
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
