const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_DISPLAY_NAME,
  MAX_DISPLAY_NAME_LENGTH,
  clampPanelPosition,
  displayInitials,
  normalizeDisplayName,
  normalizePanelPosition,
  normalizePreferences
} = require("../extension/content/settings-model.js");

test("Note Taker is the default visible name", () => {
  assert.equal(normalizeDisplayName(""), DEFAULT_DISPLAY_NAME);
  assert.deepEqual(normalizePreferences(null), {
    displayName: "Note Taker",
    panelMinimized: false,
    panelPosition: null
  });
});

test("custom display names are cleaned and bounded", () => {
  assert.equal(normalizeDisplayName("  Mi   Asistente  "), "Mi Asistente");
  assert.equal(normalizeDisplayName("x".repeat(100)).length, MAX_DISPLAY_NAME_LENGTH);
});

test("initials adapt to one or multiple words", () => {
  assert.equal(displayInitials("Note Taker"), "NT");
  assert.equal(displayInitials("Minuta"), "MI");
  assert.equal(displayInitials("Mi asistente privado"), "MA");
});

test("panel state is normalized for persistence", () => {
  assert.deepEqual(normalizePanelPosition({ x: 42.7, y: "91" }), { x: 43, y: 91 });
  assert.equal(normalizePanelPosition({ x: "nope", y: 10 }), null);
  assert.deepEqual(
    normalizePreferences({
      displayName: "Minutes",
      panelMinimized: true,
      panelPosition: { x: 100, y: 200 }
    }),
    {
      displayName: "Minutes",
      panelMinimized: true,
      panelPosition: { x: 100, y: 200 }
    }
  );
});

test("panel position stays inside the visible viewport", () => {
  assert.deepEqual(
    clampPanelPosition(
      { x: -50, y: 900 },
      { width: 1_000, height: 700 },
      { width: 360, height: 300 }
    ),
    { x: 12, y: 388 }
  );
  assert.equal(clampPanelPosition(null, { width: 1_000, height: 700 }, { width: 360, height: 300 }), null);
});
