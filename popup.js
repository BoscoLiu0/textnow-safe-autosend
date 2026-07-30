const DEFAULT_SETTINGS = {
  recipient: "",
  message: "Keeping my TextNow number active.",
  weekday: 1,
  hour: 19,
  minute: 30,
};

const form = document.querySelector("#settings-form");
const recipientInput = document.querySelector("#recipient");
const messageInput = document.querySelector("#message");
const weekdayInput = document.querySelector("#weekday");
const timeInput = document.querySelector("#time");
const saveButton = document.querySelector("#save");
const testButton = document.querySelector("#test-send");
const statusElement = document.querySelector("#status");
const nextRunElement = document.querySelector("#next-run");

function pad(value) {
  return String(value).padStart(2, "0");
}

function readForm() {
  const [hour, minute] = timeInput.value.split(":").map(Number);
  return {
    recipient: recipientInput.value.trim(),
    message: messageInput.value.trim(),
    weekday: Number(weekdayInput.value),
    hour,
    minute,
  };
}

function showStatus(kind, message) {
  statusElement.className = kind ?? "";
  statusElement.textContent = message;
}

function formatDate(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function load() {
  const stored = await chrome.storage.local.get([
    "settings",
    "lastResult",
    "nextRunAt",
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };

  recipientInput.value = settings.recipient;
  messageInput.value = settings.message;
  weekdayInput.value = String(settings.weekday);
  timeInput.value = `${pad(settings.hour)}:${pad(settings.minute)}`;

  if (stored.lastResult) {
    showStatus(
      stored.lastResult.kind,
      `${stored.lastResult.message}（${formatDate(stored.lastResult.at)}）`,
    );
  }
  if (stored.nextRunAt) {
    nextRunElement.textContent = `下一次计划：${formatDate(stored.nextRunAt)}`;
  }
}

async function saveSettings() {
  if (!form.reportValidity()) return false;
  const settings = readForm();
  await chrome.storage.local.set({ settings });

  const response = await chrome.runtime.sendMessage({ type: "RESCHEDULE" });
  if (!response?.ok) {
    showStatus("error", response?.error ?? "无法保存计划。");
    return false;
  }

  showStatus("success", "设置已保存在这台 Chrome。");
  nextRunElement.textContent = response.when
    ? `下一次计划：${formatDate(new Date(response.when).toISOString())}`
    : "";
  return true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  try {
    await saveSettings();
  } catch (error) {
    showStatus("error", error.message);
  } finally {
    saveButton.disabled = false;
  }
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  try {
    const saved = await saveSettings();
    if (!saved) return;

    showStatus("", "正在打开 TextNow 并测试发送……");
    const response = await chrome.runtime.sendMessage({ type: "SEND_NOW" });
    if (response?.ok) showStatus("success", response.message);
    else showStatus("error", response?.error ?? "测试发送失败。");
  } catch (error) {
    showStatus("error", error.message);
  } finally {
    testButton.disabled = false;
  }
});

load().catch((error) => showStatus("error", error.message));
