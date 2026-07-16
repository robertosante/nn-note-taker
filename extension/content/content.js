(function initializeNoteTakerCapture() {
  if (window.__noteTakerCaptureLoaded) return;
  window.__noteTakerCaptureLoaded = true;

  const {
    CaptionAccumulator,
    consolidateObservations,
    normalizeText
  } = globalThis.NoteTakerCaptionModel;
  const {
    DEFAULT_DISPLAY_NAME,
    MAX_DISPLAY_NAME_LENGTH,
    SETTINGS_KEY,
    clampPanelPosition,
    displayInitials,
    normalizeDisplayName,
    normalizePreferences
  } = globalThis.NoteTakerSettings;
  const STABILITY_DELAY_MS = 1_500;
  const MISSING_GRACE_MS = 900;
  const PRIMARY_ENTRY_SELECTOR = ".nMcdL.bj4p3b";
  const ENTRY_SELECTOR = `${PRIMARY_ENTRY_SELECTOR}, .nMcdL, [jscontroller='TEjq6e'], [jscontroller='D1tHje']`;
  const PRIMARY_TEXT_SELECTOR = ".ygicle.VbkSUe";
  const FALLBACK_TEXT_SELECTOR = ".iTTPOb";
  const TEXT_SELECTOR = `${PRIMARY_TEXT_SELECTOR}, ${FALLBACK_TEXT_SELECTOR}`;
  const SPEAKER_SELECTOR = ".NWpY1d, .zQRpq, .iOzk7, [data-self-name], [data-speaker-name], .lRwCcd";

  let panel;
  let captureObserver;
  let scanScheduled = false;
  let meeting = null;
  let accumulator = null;
  let observedStreams = new Map();
  let backupEvents = [];
  let nativeHealthy = false;
  let nativeError = null;
  let meetingsDirectory = null;
  let stopping = false;
  let dragState = null;
  let preferences = normalizePreferences();

  function eventId() {
    return crypto.randomUUID();
  }

  function isoNow() {
    return new Date().toISOString();
  }

  async function loadPreferences() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return normalizePreferences(stored?.[SETTINGS_KEY]);
    } catch (_error) {
      return normalizePreferences();
    }
  }

  async function savePreferences(changes) {
    preferences = normalizePreferences({ ...preferences, ...changes });
    await chrome.storage.local.set({ [SETTINGS_KEY]: preferences });
    applyPreferences();
  }

  async function saveDisplayName(value) {
    await savePreferences({ displayName: value });
  }

  async function resetDisplayName() {
    await savePreferences({ displayName: DEFAULT_DISPLAY_NAME });
  }

  function meetingTitle() {
    const cleaned = document.title
      .replace(/\s*[—–-]\s*Google Meet.*$/i, "")
      .replace(/^Google Meet\s*[—–-]?\s*/i, "")
      .trim();
    const code = location.pathname.split("/").filter(Boolean)[0];
    return cleaned || (code ? `Google Meet ${code}` : "Google Meet");
  }

  function buildEvent(type, payload = {}) {
    return {
      protocol_version: 1,
      event_id: eventId(),
      type,
      meeting_id: meeting.id,
      sent_at: isoNow(),
      ...payload
    };
  }

  async function emitEvent(event) {
    backupEvents.push(event);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "note_taker_native_event",
        event
      });
      nativeHealthy = Boolean(response?.ok);
      nativeError = nativeHealthy ? null : (response?.error || "The native host rejected the event");
      updateStorageIndicator();
      return nativeHealthy;
    } catch (error) {
      nativeHealthy = false;
      nativeError = error?.message || "The native host could not be reached";
      updateStorageIndicator();
      return false;
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function applyBranding() {
    const displayName = normalizeDisplayName(preferences.displayName);
    const kicker = document.getElementById("nt-brand-name");
    const brandMark = document.getElementById("nt-brand-mark");
    const input = document.getElementById("nt-settings-name");

    if (panel) panel.setAttribute("aria-label", `${displayName}: local caption capture`);
    if (kicker) kicker.textContent = displayName;
    if (brandMark) brandMark.textContent = displayInitials(displayName);
    if (input) input.value = displayName;
  }

  function applyPreferences() {
    applyBranding();
    applyMinimizedState();
    applyPanelPosition();
  }

  function applyMinimizedState() {
    if (!panel) return;
    const minimized = Boolean(preferences.panelMinimized);
    const button = document.getElementById("nt-minimize");
    panel.classList.toggle("nt-minimized", minimized);
    if (button) {
      button.textContent = minimized ? "+" : "−";
      button.title = minimized ? "Expand panel" : "Minimize panel";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", String(!minimized));
    }
    if (minimized) setSettingsOpen(false);
    requestAnimationFrame(applyPanelPosition);
  }

  function setPanelMinimized(minimized) {
    savePreferences({ panelMinimized: Boolean(minimized) });
  }

  function visiblePanelPosition(position) {
    if (!panel || !position) return null;
    const rect = panel.getBoundingClientRect();
    return clampPanelPosition(
      position,
      { width: window.innerWidth, height: window.innerHeight },
      { width: rect.width, height: rect.height }
    );
  }

  function movePanel(position) {
    const visible = visiblePanelPosition(position);
    if (!visible) return null;
    panel.style.left = `${visible.x}px`;
    panel.style.top = `${visible.y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    return visible;
  }

  function applyPanelPosition() {
    movePanel(preferences.panelPosition);
  }

  function beginPanelDrag(event) {
    if (event.button !== 0 || event.target.closest("button, input, a, select, textarea")) return;
    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    panel.classList.add("nt-dragging");
    event.preventDefault();
  }

  function dragPanel(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    movePanel({
      x: event.clientX - dragState.offsetX,
      y: event.clientY - dragState.offsetY
    });
  }

  function finishPanelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const position = { x: rect.left, y: rect.top };
    dragState = null;
    panel.classList.remove("nt-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    savePreferences({ panelPosition: position });
  }

  function enablePanelDragging(handle) {
    handle.addEventListener("pointerdown", beginPanelDrag);
    handle.addEventListener("pointermove", dragPanel);
    handle.addEventListener("pointerup", finishPanelDrag);
    handle.addEventListener("pointercancel", finishPanelDrag);
  }

  function setSettingsOpen(open) {
    const settingsPanel = document.getElementById("nt-settings");
    const settingsButton = document.getElementById("nt-settings-toggle");
    if (!settingsPanel || !settingsButton) return;

    settingsPanel.hidden = !open;
    settingsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      document.getElementById("nt-settings-name")?.focus();
      refreshNativeSettings();
    }
  }

  function setMeetingsDirectory(path) {
    meetingsDirectory = path || null;
    const pathElement = document.getElementById("nt-settings-directory");
    if (!pathElement) return;

    pathElement.textContent = meetingsDirectory || "Native host unavailable";
    pathElement.title = meetingsDirectory || nativeError || "Native host unavailable";
  }

  function updateDirectoryButtonState() {
    const button = document.getElementById("nt-choose-directory");
    if (button) button.disabled = Boolean(meeting || stopping);
  }

  async function refreshNativeSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "note_taker_get_settings" });
      if (!response?.ok) throw new Error(response?.error || "Native host unavailable");

      nativeHealthy = true;
      nativeError = null;
      setMeetingsDirectory(response.settings?.meetings_dir);
    } catch (error) {
      nativeHealthy = false;
      nativeError = error?.message || "Native host unavailable";
      setMeetingsDirectory(null);
    }
    updateStorageIndicator();
  }

  async function chooseMeetingsDirectory() {
    if (meeting || stopping) {
      showToast("Finish the current capture before changing folders.", "warning");
      return;
    }

    const button = document.getElementById("nt-choose-directory");
    if (button) {
      button.disabled = true;
      button.textContent = "Opening…";
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: "note_taker_choose_directory" });
      if (!response?.ok) throw new Error(response?.error || "The folder could not be changed");

      nativeHealthy = true;
      nativeError = null;
      setMeetingsDirectory(response.settings?.meetings_dir);
      showToast(
        response.cancelled ? "Folder unchanged." : "Meeting folder updated.",
        response.cancelled ? "info" : "success"
      );
    } catch (error) {
      nativeHealthy = false;
      nativeError = error?.message || "Native host unavailable";
      showToast(nativeError, "warning");
    } finally {
      if (button) button.textContent = "Choose folder";
      updateDirectoryButtonState();
      updateStorageIndicator();
    }
  }

  function buildSettingsPanel() {
    const settingsPanel = createElement("form", "nt-settings");
    settingsPanel.id = "nt-settings";
    settingsPanel.hidden = true;

    const label = createElement("label", "nt-settings-label", "DISPLAY NAME");
    label.htmlFor = "nt-settings-name";
    const input = createElement("input", "nt-settings-input");
    input.id = "nt-settings-name";
    input.name = "displayName";
    input.type = "text";
    input.maxLength = MAX_DISPLAY_NAME_LENGTH;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = preferences.displayName;

    const hint = createElement(
      "p",
      "nt-settings-hint",
      "This changes the panel name only. Existing meetings and files are not renamed."
    );
    const actions = createElement("div", "nt-settings-actions");
    const saveButton = createElement("button", "nt-button nt-button-primary", "Save");
    saveButton.type = "submit";
    const resetButton = createElement("button", "nt-button", "Reset");
    resetButton.type = "button";
    resetButton.addEventListener("click", async () => {
      await resetDisplayName();
      showToast("Display name reset to Note Taker.", "success");
    });
    actions.append(saveButton, resetButton);

    settingsPanel.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveDisplayName(input.value);
      setSettingsOpen(false);
      showToast(`Display name: ${preferences.displayName}`, "success");
    });

    const directorySection = createElement("div", "nt-settings-section");
    const directoryLabel = createElement("p", "nt-settings-label", "SAVE MEETING NOTES TO");
    const directoryPath = createElement("output", "nt-directory-path", "Checking native host…");
    directoryPath.id = "nt-settings-directory";
    const chooseButton = createElement("button", "nt-button nt-directory-button", "Choose folder");
    chooseButton.id = "nt-choose-directory";
    chooseButton.type = "button";
    chooseButton.addEventListener("click", chooseMeetingsDirectory);
    const directoryHint = createElement(
      "p",
      "nt-settings-hint",
      "The macOS picker can also create a folder. Raw event logs stay in its hidden .note-taker directory."
    );
    directorySection.append(directoryLabel, directoryPath, chooseButton, directoryHint);

    settingsPanel.append(label, input, hint, actions, directorySection);
    return settingsPanel;
  }

  function buildPanel() {
    panel = createElement("section", "nt-panel");
    panel.id = "note-taker-capture";
    panel.setAttribute("aria-label", `${preferences.displayName}: local caption capture`);

    const header = createElement("header", "nt-header nt-drag-handle");
    header.title = "Drag to move";
    enablePanelDragging(header);

    const brand = createElement("div", "nt-brand");
    const brandMarkWrap = createElement("span", "nt-brand-mark-wrap");
    const brandMark = createElement("span", "nt-brand-mark", displayInitials(preferences.displayName));
    brandMark.id = "nt-brand-mark";
    const captureDot = createElement("span", "nt-capture-dot");
    captureDot.setAttribute("aria-hidden", "true");
    brandMarkWrap.append(brandMark, captureDot);
    const headingGroup = createElement("div", "nt-heading-group");
    const kicker = createElement("p", "nt-kicker", preferences.displayName);
    kicker.id = "nt-brand-name";
    headingGroup.append(kicker);
    headingGroup.append(createElement("h2", "nt-title", "Meet captions"));
    brand.append(brandMarkWrap, headingGroup);

    const headerCount = createElement("span", "nt-header-count", "0");
    headerCount.id = "nt-header-count";
    headerCount.title = "Captured notes";

    const headerActions = createElement("div", "nt-header-actions");
    const settingsButton = createElement("button", "nt-icon-button nt-settings-button", "Aa");
    settingsButton.id = "nt-settings-toggle";
    settingsButton.type = "button";
    settingsButton.title = "Settings";
    settingsButton.setAttribute("aria-label", "Open settings");
    settingsButton.setAttribute("aria-controls", "nt-settings");
    settingsButton.setAttribute("aria-expanded", "false");
    settingsButton.addEventListener("click", () => {
      const settingsPanel = document.getElementById("nt-settings");
      setSettingsOpen(Boolean(settingsPanel?.hidden));
    });

    const minimizeButton = createElement("button", "nt-icon-button", "−");
    minimizeButton.id = "nt-minimize";
    minimizeButton.type = "button";
    minimizeButton.title = "Minimize panel";
    minimizeButton.setAttribute("aria-label", "Minimize panel");
    minimizeButton.setAttribute("aria-expanded", "true");
    minimizeButton.addEventListener("click", () => {
      setPanelMinimized(!preferences.panelMinimized);
    });

    const closeButton = createElement("button", "nt-icon-button", "×");
    closeButton.type = "button";
    closeButton.title = "Hide panel";
    closeButton.setAttribute("aria-label", "Hide panel");
    closeButton.addEventListener("click", () => panel.classList.add("nt-hidden"));
    headerActions.append(settingsButton, minimizeButton, closeButton);
    header.append(brand, headerCount, headerActions);

    const content = createElement("div", "nt-content");
    const settingsPanel = buildSettingsPanel();

    const signal = createElement("div", "nt-signal");
    const statusGroup = createElement("div", "nt-status-group");
    const statusDot = createElement("span", "nt-status-dot");
    statusDot.setAttribute("aria-hidden", "true");
    const status = createElement("span", "nt-status", "Ready");
    status.id = "nt-status";
    statusGroup.append(statusDot, status);
    const storage = createElement("span", "nt-storage", "Checking storage…");
    storage.id = "nt-storage";
    signal.append(statusGroup, storage);

    const notes = createElement("section", "nt-notes");
    notes.setAttribute("aria-labelledby", "nt-notes-title");
    const notesHeader = createElement("div", "nt-notes-header");
    const notesTitle = createElement("h3", "nt-notes-title", "Live notes");
    notesTitle.id = "nt-notes-title";
    const notesCount = createElement("span", "nt-notes-count", "0 notes");
    notesCount.id = "nt-notes-count";
    notesHeader.append(notesTitle, notesCount);
    const feed = createElement("div", "nt-feed");
    feed.id = "nt-feed";
    feed.setAttribute("role", "log");
    feed.setAttribute("aria-live", "polite");
    feed.setAttribute("aria-relevant", "additions text");
    notes.append(notesHeader, feed);

    const controls = createElement("div", "nt-controls");
    const startButton = createElement("button", "nt-button nt-button-primary", "Start");
    startButton.id = "nt-start";
    startButton.type = "button";
    startButton.addEventListener("click", startCapture);

    const stopButton = createElement("button", "nt-button", "Finish");
    stopButton.id = "nt-stop";
    stopButton.type = "button";
    stopButton.disabled = true;
    stopButton.addEventListener("click", stopCapture);

    const backupButton = createElement("button", "nt-button nt-button-quiet", "Export .jsonl backup");
    backupButton.id = "nt-backup";
    backupButton.type = "button";
    backupButton.addEventListener("click", exportBackup);
    controls.append(startButton, stopButton, backupButton);

    const footer = createElement("footer", "nt-footer", "Private · local · no audio");
    const toast = createElement("div", "nt-toast");
    toast.id = "nt-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    content.append(settingsPanel, signal, notes, controls, footer);
    panel.append(header, content, toast);
    document.documentElement.append(panel);
    applyPreferences();
    updateCountAndPreview();
    refreshNativeSettings();
  }

  function setStatus(value, active = false) {
    const status = document.getElementById("nt-status");
    if (!status) return;
    status.textContent = value;
    panel?.classList.toggle("nt-capturing", active);
  }

  function updateStorageIndicator() {
    const storage = document.getElementById("nt-storage");
    if (!storage) return;
    storage.textContent = nativeHealthy ? "Saved locally" : "Backup only";
    storage.title = nativeHealthy
      ? (meetingsDirectory ? `Saving to ${meetingsDirectory}` : "Native host connected")
      : (nativeError || "Native host unavailable");
    storage.classList.toggle("nt-storage-ok", nativeHealthy);
  }

  function updateCountAndPreview(record) {
    const count = accumulator?.all().length || 0;
    const headerCount = document.getElementById("nt-header-count");
    const notesCount = document.getElementById("nt-notes-count");
    if (headerCount) headerCount.textContent = String(count);
    if (notesCount) notesCount.textContent = `${count} ${count === 1 ? "note" : "notes"}`;
    renderNoteFeed(record);
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderNoteFeed(latestRecord) {
    const feed = document.getElementById("nt-feed");
    if (!feed) return;

    const records = accumulator?.all() || [];
    feed.replaceChildren();
    if (!records.length) {
      const empty = createElement(
        "div",
        "nt-feed-empty",
        meeting ? "Listening for captions…" : "Turn on captions in Meet, then press Start."
      );
      feed.append(empty);
      return;
    }

    for (const record of records.slice(-6)) {
      const item = createElement("article", "nt-note-item");
      if (latestRecord?.id === record.id) item.classList.add("nt-note-item-latest");
      const meta = createElement("div", "nt-note-meta");
      const speaker = createElement("strong", "nt-note-speaker", record.speaker || "Unknown");
      const time = createElement("time", "nt-note-time", formatElapsed(record.start_ms));
      meta.append(speaker, time);
      item.append(meta, createElement("p", "nt-note-text", record.text));
      feed.append(item);
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function showToast(message, kind = "info") {
    const toast = document.getElementById("nt-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.classList.add("nt-toast-visible");
    clearTimeout(showToast.timeoutId);
    showToast.timeoutId = setTimeout(() => toast.classList.remove("nt-toast-visible"), 3_200);
  }

  async function startCapture() {
    if (meeting || stopping) return;

    const startedAt = Date.now();
    meeting = {
      id: `meet_${startedAt}_${crypto.randomUUID().slice(0, 8)}`,
      startedAt,
      title: meetingTitle()
    };
    updateDirectoryButtonState();
    accumulator = new CaptionAccumulator(meeting.id);
    observedStreams = new Map();
    backupEvents = [];
    nativeHealthy = false;
    nativeError = null;

    const startEvent = buildEvent("meeting_started", {
      meeting: {
        title: meeting.title,
        started_at: new Date(startedAt).toISOString(),
        url: location.href,
        meeting_code: location.pathname.split("/").filter(Boolean)[0] || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: document.documentElement.lang || navigator.language || "und"
      }
    });

    const savedLocally = await emitEvent(startEvent);
    captureObserver = new MutationObserver(scheduleScan);
    captureObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    document.getElementById("nt-start").disabled = true;
    document.getElementById("nt-stop").disabled = false;
    setStatus("Capturing", true);
    updateCountAndPreview();
    scheduleScan();
    showToast(
      savedLocally ? "Saving captions to your meeting folder." : `Native host: ${nativeError || "unavailable"}`,
      savedLocally ? "success" : "warning"
    );
  }

  function scheduleScan() {
    if (scanScheduled || !meeting) return;
    scanScheduled = true;
    queueMicrotask(() => {
      scanScheduled = false;
      scanCaptions();
    });
  }

  function sourceForTextElement(textElement) {
    return textElement.closest(ENTRY_SELECTOR) || textElement.parentElement || textElement;
  }

  function speakerForSource(source) {
    const direct = source.querySelector?.(SPEAKER_SELECTOR);
    if (direct) return normalizeText(direct.textContent);

    const parentEntry = source.parentElement?.closest?.(ENTRY_SELECTOR);
    const parentSpeaker = parentEntry?.querySelector?.(SPEAKER_SELECTOR);
    return normalizeText(parentSpeaker?.textContent) || "Unknown";
  }

  function matchingTextElements(source, selector) {
    const matches = source.matches?.(selector) ? [source] : [];
    return matches.concat(Array.from(source.querySelectorAll?.(selector) || []));
  }

  function textForSource(source) {
    let elements = matchingTextElements(source, PRIMARY_TEXT_SELECTOR);
    if (!elements.length) elements = matchingTextElements(source, FALLBACK_TEXT_SELECTOR);
    return normalizeText(elements.map((element) => normalizeText(element.textContent)).filter(Boolean).join(" "));
  }

  function captionSources() {
    const primary = Array.from(document.querySelectorAll(PRIMARY_ENTRY_SELECTOR))
      .filter((source) => source.isConnected && textForSource(source));
    if (primary.length) return primary;

    const sources = [];
    const seen = new Set();
    for (const textElement of document.querySelectorAll(TEXT_SELECTOR)) {
      if (!textElement.isConnected) continue;
      const source = sourceForTextElement(textElement);
      if (seen.has(source)) continue;
      seen.add(source);
      sources.push(source);
    }
    return sources;
  }

  function currentCaptionObservations() {
    const raw = captionSources().map((source, slot) => ({
      source,
      slot,
      speaker: speakerForSource(source),
      text: textForSource(source)
    }));
    return consolidateObservations(raw);
  }

  function scanCaptions() {
    if (!meeting) return;
    const activeStreamKeys = new Set();

    for (const observation of currentCaptionObservations()) {
      const { source, speaker, streamKey, text } = observation;
      activeStreamKeys.add(streamKey);
      const previous = observedStreams.get(streamKey);
      if (previous?.missingTimerId) {
        clearTimeout(previous.missingTimerId);
        previous.missingTimerId = null;
      }
      if (previous?.text === text && previous?.speaker === speaker) {
        previous.source = source;
        continue;
      }
      if (previous?.timerId) clearTimeout(previous.timerId);
      const state = {
        streamKey,
        source,
        speaker,
        text,
        observedAt: Date.now(),
        timerId: null,
        missingTimerId: null
      };
      state.timerId = setTimeout(() => commitObservation(state), STABILITY_DELAY_MS);
      observedStreams.set(streamKey, state);
    }

    for (const [streamKey, state] of observedStreams.entries()) {
      if (activeStreamKeys.has(streamKey) || state.missingTimerId) continue;
      state.missingTimerId = setTimeout(
        () => finalizeMissingStream(streamKey, state),
        MISSING_GRACE_MS
      );
    }
  }

  async function commitObservation(state) {
    if (!meeting || !accumulator) return;
    const current = observedStreams.get(state.streamKey);
    if (current !== state) return;
    state.timerId = null;

    const elapsed = state.observedAt - meeting.startedAt;
    const result = accumulator.commit(state.streamKey, state.speaker, state.text, elapsed);
    if (result.action === "ignored") return;

    updateCountAndPreview(result.record);
    await emitEvent(buildEvent("caption_upsert", { caption: result.record }));
  }

  async function finalizeMissingStream(streamKey, expectedState) {
    if (!meeting || !accumulator) return;
    const current = observedStreams.get(streamKey);
    if (current !== expectedState) return;

    current.missingTimerId = null;
    if (current.timerId) {
      clearTimeout(current.timerId);
      current.timerId = null;
      await commitObservation(current);
    }
    accumulator.closeStream(streamKey);
    observedStreams.delete(streamKey);
  }

  async function stopCapture() {
    if (!meeting || stopping) return;
    stopping = true;
    captureObserver?.disconnect();
    captureObserver = null;

    const commits = [];
    for (const state of observedStreams.values()) {
      if (state.timerId) clearTimeout(state.timerId);
      if (state.missingTimerId) clearTimeout(state.missingTimerId);
      state.missingTimerId = null;
      commits.push(commitObservation(state));
    }
    await Promise.allSettled(commits);
    accumulator.closeAllStreams();

    const stoppedAt = Date.now();
    const stopEvent = buildEvent("meeting_stopped", {
      meeting: {
        ended_at: new Date(stoppedAt).toISOString(),
        duration_ms: stoppedAt - meeting.startedAt,
        caption_count: accumulator.all().length
      }
    });
    const savedLocally = await emitEvent(stopEvent);

    setStatus("Saved", false);
    document.getElementById("nt-start").disabled = false;
    document.getElementById("nt-stop").disabled = true;
    if (!savedLocally) {
      exportBackup();
      showToast("A backup was downloaded. Import it with the CLI.", "warning");
    } else {
      showToast("Markdown saved to your meeting folder.", "success");
    }

    meeting = null;
    accumulator = null;
    observedStreams = new Map();
    stopping = false;
    updateDirectoryButtonState();
  }

  function exportBackup() {
    if (!backupEvents.length) {
      showToast("There is no capture to back up yet.", "warning");
      return;
    }

    const meetingId = backupEvents[0]?.meeting_id || `meet_${Date.now()}`;
    const body = `${backupEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
    const blob = new Blob([body], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${meetingId}.jsonl`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "note_taker_toggle_panel") {
      panel.classList.toggle("nt-hidden");
      if (!panel.classList.contains("nt-hidden")) requestAnimationFrame(applyPanelPosition);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    preferences = normalizePreferences(changes[SETTINGS_KEY].newValue);
    applyPreferences();
  });

  window.addEventListener("resize", applyPanelPosition);

  loadPreferences().then((storedPreferences) => {
    preferences = storedPreferences;
    buildPanel();
  });
})();
