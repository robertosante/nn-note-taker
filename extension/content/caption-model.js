(function exposeCaptionModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NoteTakerCaptionModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCaptionModel() {
  const DUPLICATE_WINDOW_MS = 15_000;
  const SELF_SPEAKER_NAMES = new Set(["me", "myself", "tu", "tú", "yo", "you"]);
  const UNKNOWN_SPEAKER_NAMES = new Set(["", "sin identificar", "unknown", "desconocido"]);

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u200b/g, "")
      .trim();
  }

  function normalizeSpeaker(value) {
    return normalizeText(value) || "Unknown";
  }

  function normalizeComparable(value) {
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function comparableTokens(value) {
    const comparable = normalizeComparable(value);
    return comparable ? comparable.split(" ") : [];
  }

  function tokensStartWith(tokens, prefix) {
    if (prefix.length > tokens.length) return false;
    return prefix.every((token, index) => tokens[index] === token);
  }

  function commonPrefixLength(left, right) {
    const limit = Math.min(left.length, right.length);
    let index = 0;
    while (index < limit && left[index] === right[index]) index += 1;
    return index;
  }

  // Meet continually rewrites the unstable tail of a caption. Punctuation,
  // accents, capitalization, and several trailing words may all change before
  // the caption settles, so exact startsWith() checks are not sufficient.
  function classifyCaptionRevision(previousValue, nextValue) {
    const previousText = normalizeText(previousValue);
    const nextText = normalizeText(nextValue);
    if (previousText === nextText) return "same";

    const previous = comparableTokens(previousText);
    const next = comparableTokens(nextText);
    if (!previous.length || !next.length) return "distinct";

    if (previous.length === next.length && previous.every((token, index) => token === next[index])) {
      return "revision";
    }

    if (tokensStartWith(next, previous)) return "revision";
    if (tokensStartWith(previous, next)) return "stale";

    const sharedPrefix = commonPrefixLength(previous, next);
    const sharedRatio = sharedPrefix / Math.min(previous.length, next.length);
    const looksLikeCorrectedTail = sharedPrefix >= 5 || (sharedPrefix >= 3 && sharedRatio >= 0.5);

    if (!looksLikeCorrectedTail) return "distinct";
    if (next.length < previous.length * 0.8) return "stale";
    return "revision";
  }

  function captionStreamKey(speakerValue, fallbackKey = "0") {
    const speaker = normalizeSpeaker(speakerValue);
    const comparable = normalizeComparable(speaker);
    if (SELF_SPEAKER_NAMES.has(comparable)) return "speaker:self";
    if (UNKNOWN_SPEAKER_NAMES.has(comparable)) {
      return `speaker:unknown:${normalizeComparable(fallbackKey) || "0"}`;
    }
    return `speaker:${comparable}`;
  }

  function consolidateObservations(observations) {
    const byStream = new Map();

    observations.forEach((observation, index) => {
      const text = normalizeText(observation.text);
      if (!text) return;

      const speaker = normalizeSpeaker(observation.speaker);
      const streamKey = captionStreamKey(speaker, observation.slot ?? index);
      const incoming = { ...observation, speaker, text, streamKey };
      const existing = byStream.get(streamKey);
      if (!existing) {
        byStream.set(streamKey, incoming);
        return;
      }

      const relation = classifyCaptionRevision(existing.text, incoming.text);
      if (relation === "stale") return;
      byStream.set(streamKey, incoming);
    });

    return Array.from(byStream.values());
  }

  class CaptionAccumulator {
    constructor(meetingId) {
      this.meetingId = meetingId;
      this.sequence = 0;
      this.activeByStream = new Map();
      this.records = new Map();
      this.recentFingerprints = new Map();
    }

    commit(streamKey, speakerValue, textValue, elapsedMs) {
      const text = normalizeText(textValue);
      const speaker = normalizeSpeaker(speakerValue);
      const timestamp = Math.max(0, Number(elapsedMs) || 0);
      if (!text) return { action: "ignored", reason: "empty" };

      const stableStreamKey = streamKey || captionStreamKey(speaker);
      const activeId = this.activeByStream.get(stableStreamKey);
      const active = activeId ? this.records.get(activeId) : null;

      if (active) {
        const relation = classifyCaptionRevision(active.text, text);
        if (relation === "same" || relation === "stale") {
          return { action: "ignored", reason: "same-or-stale", record: { ...active } };
        }

        if (relation === "revision") {
          active.speaker = speaker;
          active.text = text;
          active.updated_ms = timestamp;
          this.rememberFingerprint(active);
          this.pruneFingerprints(timestamp);
          return { action: "update", record: { ...active } };
        }
      }

      const fingerprint = this.fingerprint(speaker, text);
      const recent = this.recentFingerprints.get(fingerprint);
      if (recent && timestamp - recent.updated_ms <= DUPLICATE_WINDOW_MS) {
        if (this.records.has(recent.id)) this.activeByStream.set(stableStreamKey, recent.id);
        return { action: "ignored", reason: "recent-duplicate", record: { ...recent } };
      }

      this.sequence += 1;
      const record = {
        id: `${this.meetingId}_caption_${String(this.sequence).padStart(6, "0")}`,
        sequence: this.sequence,
        speaker,
        text,
        start_ms: timestamp,
        updated_ms: timestamp
      };

      this.records.set(record.id, record);
      this.activeByStream.set(stableStreamKey, record.id);
      this.rememberFingerprint(record);
      this.pruneFingerprints(timestamp);
      return { action: "insert", record: { ...record } };
    }

    closeStream(streamKey) {
      this.activeByStream.delete(streamKey);
    }

    closeAllStreams() {
      this.activeByStream.clear();
    }

    fingerprint(speaker, text) {
      return `${normalizeComparable(speaker)}|${normalizeComparable(text)}`;
    }

    rememberFingerprint(record) {
      this.recentFingerprints.set(this.fingerprint(record.speaker, record.text), { ...record });
    }

    pruneFingerprints(nowMs) {
      for (const [fingerprint, record] of this.recentFingerprints.entries()) {
        if (nowMs - record.updated_ms > DUPLICATE_WINDOW_MS * 4) {
          this.recentFingerprints.delete(fingerprint);
        }
      }
    }

    all() {
      return Array.from(this.records.values())
        .sort((left, right) => left.sequence - right.sequence)
        .map((record) => ({ ...record }));
    }
  }

  return {
    CaptionAccumulator,
    captionStreamKey,
    classifyCaptionRevision,
    consolidateObservations,
    normalizeComparable,
    normalizeSpeaker,
    normalizeText
  };
});
