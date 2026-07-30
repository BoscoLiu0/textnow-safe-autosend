const ALARM_NAME = "textnow-weekly-send";
const MESSAGING_URL = "https://www.textnow.com/messaging";
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = Object.freeze({
  recipient: "",
  message: "Keeping my TextNow number active.",
  weekday: 1,
  hour: 19,
  minute: 30,
});

let sending = false;

function normalizeRecipient(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error("收件号码必须是美国或加拿大的 10 位号码。");
}

function validateSettings(settings) {
  const recipient = normalizeRecipient(settings.recipient);
  const message = String(settings.message ?? "").trim();
  const weekday = Number(settings.weekday);
  const hour = Number(settings.hour);
  const minute = Number(settings.minute);

  if (!message || message.length > 500) {
    throw new Error("短信内容必须为 1–500 个字符。");
  }
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error("星期设置无效。");
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("小时设置无效。");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("分钟设置无效。");
  }

  return { recipient, message, weekday, hour, minute };
}

function nextWeeklyTime(settings, now = new Date()) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(settings.hour, settings.minute, 0, 0);

  let daysAhead = (settings.weekday - now.getDay() + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= now.getTime()) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

async function setStatus(kind, message) {
  const lastResult = {
    kind,
    message,
    at: new Date().toISOString(),
  };
  await chrome.storage.local.set({ lastResult });

  const badgeText = kind === "success" ? "✓" : kind === "error" ? "!" : "";
  const badgeColor = kind === "success" ? "#188038" : "#c5221f";
  await chrome.action.setBadgeText({ text: badgeText });
  if (badgeText) await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  await chrome.action.setTitle({ title: `TextNow Weekly Sender：${message}` });
}

async function scheduleNext() {
  await chrome.alarms.clear(ALARM_NAME);
  const rawSettings = await getSettings();

  if (!rawSettings.recipient) return null;

  const settings = validateSettings(rawSettings);
  const when = nextWeeklyTime(settings).getTime();
  await chrome.alarms.create(ALARM_NAME, { when });
  await chrome.storage.local.set({ nextRunAt: new Date(when).toISOString() });
  return when;
}

function waitForTabComplete(tabId, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("TextNow 页面加载超时。"));
    }, timeoutMs);

    function listener(updatedId, changeInfo) {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

async function getTextNowTab(makeActive) {
  const tabs = await chrome.tabs.query({ url: "https://www.textnow.com/*" });
  const existing =
    tabs.find((tab) => tab.url?.includes("/messaging")) ?? tabs[0] ?? null;

  if (existing?.id) {
    return chrome.tabs.update(existing.id, {
      active: makeActive,
      url: MESSAGING_URL,
    });
  }

  return chrome.tabs.create({
    active: makeActive,
    url: MESSAGING_URL,
  });
}

async function askContentScript(tabId, payload) {
  let lastError;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "TEXTNOW_SEND",
        payload,
      });
      if (!response) throw new Error("TextNow 页面没有响应。");
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError ?? new Error("无法连接到 TextNow 页面。");
}

async function runSend({ force = false, source = "schedule" } = {}) {
  if (sending) throw new Error("已有一次发送任务正在运行。");
  sending = true;

  try {
    const settings = validateSettings(await getSettings());
    const state = await chrome.storage.local.get("lastSentAt");

    if (!force && state.lastSentAt) {
      const elapsed = Date.now() - new Date(state.lastSentAt).getTime();
      if (Number.isFinite(elapsed) && elapsed < SIX_DAYS_MS) {
        const remainingDays = Math.ceil((SIX_DAYS_MS - elapsed) / 86_400_000);
        const message = `距离上次成功发送不足 6 天，已跳过；约 ${remainingDays} 天后可再次发送。`;
        await setStatus("info", message);
        return { ok: true, skipped: true, message };
      }
    }

    const tab = await getTextNowTab(source === "manual");
    if (!tab.id) throw new Error("无法打开 TextNow 标签页。");
    await waitForTabComplete(tab.id);

    const response = await askContentScript(tab.id, {
      recipient: settings.recipient,
      message: settings.message,
    });

    if (!response.ok) throw new Error(response.error || "TextNow 没有确认发送成功。");

    const lastSentAt = new Date().toISOString();
    await chrome.storage.local.set({
      lastSentAt,
      recipientLast4: settings.recipient.slice(-4),
    });
    const message = `已成功发送到尾号 ${settings.recipient.slice(-4)}。`;
    await setStatus("success", message);
    return { ok: true, message };
  } catch (error) {
    await setStatus("error", error.message);
    return { ok: false, error: error.message };
  } finally {
    sending = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleNext().catch((error) => setStatus("error", error.message));
});

chrome.runtime.onStartup.addListener(() => {
  scheduleNext().catch((error) => setStatus("error", error.message));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runSend({ source: "schedule" })
    .finally(() => scheduleNext())
    .catch((error) => setStatus("error", error.message));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RESCHEDULE") {
    scheduleNext()
      .then((when) => sendResponse({ ok: true, when }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SEND_NOW") {
    runSend({ force: true, source: "manual" })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
