import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRemainingTime,
  normalizePhoneNumber,
  shouldAllowSend,
  validateConfig,
} from "../src/lib.mjs";

test("normalizes a 10-digit US number", () => {
  assert.equal(normalizePhoneNumber("(555) 123-4567"), "+15551234567");
});

test("accepts an 11-digit US number", () => {
  assert.equal(normalizePhoneNumber("1-555-123-4567"), "+15551234567");
});

test("rejects unsupported phone numbers", () => {
  assert.throws(() => normalizePhoneNumber("12345"), /valid 10-digit/);
});

test("validates a single-recipient configuration", () => {
  assert.deepEqual(
    validateConfig({
      recipient: "5551234567",
      message: "Keep alive",
      minimumDaysBetweenMessages: 6,
    }),
    {
      recipient: "+15551234567",
      message: "Keep alive",
      minimumDaysBetweenMessages: 6,
    },
  );
});

test("rejects an empty message", () => {
  assert.throws(
    () =>
      validateConfig({
        recipient: "5551234567",
        message: "   ",
      }),
    /cannot be empty/,
  );
});

test("rate limit allows a first send", () => {
  assert.equal(shouldAllowSend({ lastSentAt: null }).allowed, true);
});

test("rate limit blocks an early duplicate", () => {
  const result = shouldAllowSend({
    lastSentAt: "2026-07-27T12:00:00.000Z",
    now: new Date("2026-07-30T12:00:00.000Z"),
    minimumDaysBetweenMessages: 6,
  });
  assert.equal(result.allowed, false);
  assert.equal(formatRemainingTime(result.remainingMs), "3 days 0 hours");
});

test("force overrides the rate limit", () => {
  const result = shouldAllowSend({
    lastSentAt: new Date().toISOString(),
    force: true,
  });
  assert.equal(result.allowed, true);
});
