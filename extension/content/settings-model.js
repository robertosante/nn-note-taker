(function exposeNoteTakerSettings(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NoteTakerSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildNoteTakerSettings() {
  const DEFAULT_DISPLAY_NAME = "Note Taker";
  const SETTINGS_KEY = "noteTakerPreferences";
  const MAX_DISPLAY_NAME_LENGTH = 40;
  const PANEL_MARGIN = 12;

  function normalizeDisplayName(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized.slice(0, MAX_DISPLAY_NAME_LENGTH) || DEFAULT_DISPLAY_NAME;
  }

  function displayInitials(value) {
    const name = normalizeDisplayName(value);
    const words = name.split(" ").filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
    return words.slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase();
  }

  function normalizePanelPosition(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function clampPanelPosition(value, viewport, panel) {
    const position = normalizePanelPosition(value);
    if (!position) return null;

    const viewportWidth = Math.max(Number(viewport?.width) || 0, PANEL_MARGIN * 2);
    const viewportHeight = Math.max(Number(viewport?.height) || 0, PANEL_MARGIN * 2);
    const panelWidth = Math.max(Number(panel?.width) || 0, 0);
    const panelHeight = Math.max(Number(panel?.height) || 0, 0);
    const maxX = Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN);
    const maxY = Math.max(PANEL_MARGIN, viewportHeight - panelHeight - PANEL_MARGIN);

    return {
      x: Math.min(Math.max(position.x, PANEL_MARGIN), maxX),
      y: Math.min(Math.max(position.y, PANEL_MARGIN), maxY)
    };
  }

  function normalizePreferences(value) {
    return {
      displayName: normalizeDisplayName(value?.displayName),
      panelMinimized: Boolean(value?.panelMinimized),
      panelPosition: normalizePanelPosition(value?.panelPosition)
    };
  }

  return {
    DEFAULT_DISPLAY_NAME,
    MAX_DISPLAY_NAME_LENGTH,
    PANEL_MARGIN,
    SETTINGS_KEY,
    clampPanelPosition,
    displayInitials,
    normalizeDisplayName,
    normalizePanelPosition,
    normalizePreferences
  };
});
