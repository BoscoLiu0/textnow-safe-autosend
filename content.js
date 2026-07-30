const CAPTCHA_PATTERN = /verify you are human|press and hold|captcha/i;
const LOGIN_PATTERN = /what is your email|log in|sign in/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function normalizeDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function visibleElements(selectors) {
  return [...document.querySelectorAll(selectors)].filter(isVisible);
}

async function waitFor(find, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = find();
    if (result) return result;
    await sleep(300);
  }
  return null;
}

function pageHasCaptcha() {
  return CAPTCHA_PATTERN.test(document.body?.innerText ?? "");
}

function pageRequiresLogin() {
  if (/\/login(?:[/?#]|$)/i.test(location.pathname)) return true;
  if (visibleElements('input[type="password"]').length > 0) return true;
  const text = document.body?.innerText?.slice(0, 2000) ?? "";
  return LOGIN_PATTERN.test(text) && !/type a message/i.test(text);
}

function findByAccessibleName(pattern) {
  const candidates = visibleElements(
    'button,[role="button"],a,[aria-label],[title]',
  );
  return (
    candidates.find((element) => {
      const name = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      return pattern.test(name.trim());
    }) ?? null
  );
}

function setInputValue(element, value) {
  element.focus();

  if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
  } else if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
  } else {
    element.textContent = value;
  }

  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: value,
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function pressEnter(element) {
  element.focus();
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
  }
}

function findRecipientInput() {
  const selectors = [
    'input[aria-label*="recipient" i]',
    'input[placeholder*="phone number" i]',
    'input[placeholder*="name or number" i]',
    'input[placeholder^="to" i]',
    'input[data-testid*="recipient" i]',
  ];
  return selectors
    .flatMap((selector) => visibleElements(selector))
    .at(0) ?? null;
}

function findMessageBox() {
  const selectors = [
    'textarea[aria-label*="message" i]',
    'textarea[placeholder*="message" i]',
    'input[placeholder*="message" i]',
    '[contenteditable="true"][role="textbox"]',
    '[data-testid*="message-input" i]',
  ];
  return selectors
    .flatMap((selector) => visibleElements(selector))
    .at(0) ?? null;
}

function currentHeaderMatches(recipient) {
  const target = normalizeDigits(recipient);
  if (target.length !== 10) return false;

  const candidates = visibleElements(
    'header,h1,h2,h3,[role="heading"],[class*="header" i],div,span,p',
  );
  return candidates.some((element) => {
    const rect = element.getBoundingClientRect();
    const text = element.textContent?.trim() ?? "";
    if (
      rect.top < 60 ||
      rect.top > 240 ||
      rect.left < Math.max(240, window.innerWidth * 0.25) ||
      text.length > 40
    ) {
      return false;
    }
    return normalizeDigits(text).includes(target);
  });
}

function findExistingConversation(recipient) {
  const target = normalizeDigits(recipient);
  const candidates = visibleElements(
    '[role="listitem"],li,a,button,[role="button"],[data-testid*="conversation" i],[class*="conversation" i]',
  );
  return (
    candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < 80 || rect.left > window.innerWidth * 0.5) return false;
      return normalizeDigits(element.textContent).includes(target);
    }) ?? null
  );
}

async function selectRecipient(recipient) {
  const compose = findByAccessibleName(
    /new message|new conversation|compose|start conversation/i,
  );

  if (compose) {
    compose.click();
    const recipientInput = await waitFor(findRecipientInput, 8_000);
    if (!recipientInput) {
      throw new Error("找不到收件号码输入框；TextNow 页面可能已经改变。");
    }

    setInputValue(recipientInput, recipient);
    await sleep(900);

    const target = normalizeDigits(recipient);
    const suggestion = visibleElements(
      '[role="option"],[role="listitem"],[data-testid*="contact" i]',
    ).find((element) => normalizeDigits(element.textContent).includes(target));

    if (suggestion) suggestion.click();
    else pressEnter(recipientInput);
  } else {
    const conversation = findExistingConversation(recipient);
    if (!conversation) {
      throw new Error("找不到“新短信”按钮或匹配的收件人会话。");
    }
    conversation.click();
  }

  const verified = await waitFor(
    () => currentHeaderMatches(recipient),
    10_000,
  );
  if (!verified) {
    throw new Error("无法确认当前会话属于设定的收件号码，因此没有发送。");
  }
}

function messageBoxValue(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return element.textContent ?? "";
}

async function sendMessage(message) {
  const messageBox = await waitFor(findMessageBox, 15_000);
  if (!messageBox) {
    throw new Error("找不到短信输入框；TextNow 页面可能已经改变。");
  }

  setInputValue(messageBox, message);
  await sleep(300);

  const sendButton = findByAccessibleName(/^send(?: message)?$/i);
  if (sendButton) sendButton.click();
  else pressEnter(messageBox);

  const cleared = await waitFor(
    () => messageBoxValue(messageBox).trim() === "",
    6_000,
  );
  if (!cleared) {
    throw new Error("短信仍停留在输入框中，TextNow 没有确认发送成功。");
  }
}

async function run(payload) {
  if (pageHasCaptcha()) {
    throw new Error("TextNow 要求人机验证，请在普通 Chrome 中亲自完成后再测试。");
  }
  if (pageRequiresLogin()) {
    throw new Error("TextNow 尚未登录，请先在普通 Chrome 中登录。");
  }

  await selectRecipient(payload.recipient);
  await sendMessage(payload.message);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TEXTNOW_SEND") return false;

  run(message.payload)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
