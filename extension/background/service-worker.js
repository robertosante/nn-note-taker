const NATIVE_HOST = "app.note_taker.meet_captions";
const RESPONSE_TIMEOUT_MS = 30_000;

let nativePort = null;
const pending = new Map();

function messageKey(message) {
  return message?.request_id || message?.event_id;
}

function rejectPending(message) {
  for (const [key, request] of pending.entries()) {
    clearTimeout(request.timeoutId);
    request.reject(new Error(message));
    pending.delete(key);
  }
}

function connectNativeHost() {
  if (nativePort) return nativePort;

  nativePort = chrome.runtime.connectNative(NATIVE_HOST);

  nativePort.onMessage.addListener((response) => {
    const key = messageKey(response);
    if (!key || !pending.has(key)) return;

    const request = pending.get(key);
    clearTimeout(request.timeoutId);
    pending.delete(key);

    if (response.ok) {
      request.resolve(response);
    } else {
      request.reject(new Error(response.error || "The native host rejected the request"));
    }
  });

  nativePort.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || "The native host disconnected";
    nativePort = null;
    rejectPending(message);
  });

  return nativePort;
}

function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      const key = messageKey(payload);
      if (!key) throw new Error("Native messages need a request_id or event_id");

      const port = connectNativeHost();
      const timeoutId = setTimeout(() => {
        pending.delete(key);
        reject(new Error("The native host did not respond in time"));
      }, RESPONSE_TIMEOUT_MS);

      pending.set(key, { resolve, reject, timeoutId });
      port.postMessage(payload);
    } catch (error) {
      nativePort = null;
      reject(error);
    }
  });
}

function settingsRequest(type) {
  return {
    protocol_version: 1,
    request_id: crypto.randomUUID(),
    type
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let payload;
  switch (message?.type) {
  case "note_taker_native_event":
    payload = message.event;
    break;
  case "note_taker_get_settings":
    payload = settingsRequest("settings_get");
    break;
  case "note_taker_choose_directory":
    payload = settingsRequest("settings_choose_directory");
    break;
  default:
    return false;
  }

  sendNativeMessage(payload)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url?.startsWith("https://meet.google.com/")) return;
  chrome.tabs.sendMessage(tab.id, { type: "note_taker_toggle_panel" }).catch(() => {});
});
