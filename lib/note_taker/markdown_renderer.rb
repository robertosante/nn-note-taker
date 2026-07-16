# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "time"

module NoteTaker
  class MarkdownRenderer
    UNKNOWN_SPEAKERS = ["", "sin identificar", "unknown", "speaker"].freeze
    REVISION_WINDOW_MS = 90_000

    def initialize(event_log:, meetings_dir: Config.meetings_dir, drafts_dir: Config.drafts_dir)
      @event_log = event_log
      @meetings_dir = meetings_dir
      @drafts_dir = drafts_dir
      FileUtils.mkdir_p([@meetings_dir, @drafts_dir], mode: 0o700)
    end

    def render(meeting_id, force_status: nil)
      projection = project(@event_log.events(meeting_id), force_status: force_status)
      raise ArgumentError, "No meeting_started event exists for #{meeting_id}" unless projection[:started]

      content = markdown(projection)
      destination = projection[:status] == "capturing" ? draft_path(projection) : final_path(projection)
      atomic_write(destination, content)

      if projection[:status] != "capturing"
        FileUtils.rm_f(draft_path(projection))
      end
      destination
    end

    private

    def project(events, force_status: nil)
      started = events.find { |event| event["type"] == "meeting_started" }
      stopped = events.reverse.find { |event| event["type"] == "meeting_stopped" }
      interrupted = events.reverse.find { |event| event["type"] == "meeting_interrupted" }
      captions_by_id = {}

      events.each do |event|
        next unless event["type"] == "caption_upsert"
        caption = event["caption"] || {}
        id = caption["id"]
        captions_by_id[id] = caption if id
      end

      captions = captions_by_id.values
        .sort_by { |caption| [caption.fetch("sequence", 0), caption.fetch("start_ms", 0)] }
      captions = consolidate_caption_revisions(captions)

      status = force_status || if stopped
        "complete"
      elsif interrupted
        "interrupted"
      else
        "capturing"
      end

      {
        meeting_id: started&.fetch("meeting_id", nil),
        started: started,
        stopped: stopped,
        interrupted: interrupted,
        captions: captions,
        status: status
      }
    end

    def consolidate_caption_revisions(captions)
      result = []
      latest_index_by_speaker = {}

      captions.each do |caption|
        speaker_key = comparable_text(caption["speaker"])
        candidate_index = latest_index_by_speaker[speaker_key] unless unknown_speaker?(speaker_key)
        candidate = result[candidate_index] if candidate_index

        if candidate && within_revision_window?(candidate, caption)
          relation = caption_relation(candidate["text"], caption["text"])
          next if relation == :same || relation == :stale

          if relation == :revision
            result[candidate_index] = merge_caption_revision(candidate, caption)
            next
          end
        end

        result << caption
        latest_index_by_speaker[speaker_key] = result.length - 1 unless unknown_speaker?(speaker_key)
      end

      result
    end

    def within_revision_window?(previous, current)
      previous_end = previous.fetch("updated_ms", previous.fetch("start_ms", 0)).to_i
      current_start = current.fetch("start_ms", 0).to_i
      [current_start - previous_end, 0].max <= REVISION_WINDOW_MS
    end

    def merge_caption_revision(previous, current)
      current.merge(
        "id" => previous["id"],
        "sequence" => previous.fetch("sequence", current.fetch("sequence", 0)),
        "start_ms" => previous.fetch("start_ms", current.fetch("start_ms", 0)),
        "updated_ms" => [
          previous.fetch("updated_ms", previous.fetch("start_ms", 0)).to_i,
          current.fetch("updated_ms", current.fetch("start_ms", 0)).to_i
        ].max
      )
    end

    def caption_relation(previous_value, current_value)
      previous_text = previous_value.to_s.gsub(/\s+/, " ").strip
      current_text = current_value.to_s.gsub(/\s+/, " ").strip
      return :same if previous_text == current_text

      previous = comparable_tokens(previous_text)
      current = comparable_tokens(current_text)
      return :distinct if previous.empty? || current.empty?
      return :revision if previous == current
      return :revision if tokens_start_with?(current, previous)
      return :stale if tokens_start_with?(previous, current)

      shared_prefix = common_prefix_length(previous, current)
      shared_ratio = shared_prefix.to_f / [previous.length, current.length].min
      corrected_tail = shared_prefix >= 5 || (shared_prefix >= 3 && shared_ratio >= 0.5)
      return :distinct unless corrected_tail
      return :stale if current.length < previous.length * 0.8

      :revision
    end

    def comparable_tokens(value)
      comparable = comparable_text(value)
      comparable.empty? ? [] : comparable.split(" ")
    end

    def comparable_text(value)
      value.to_s
        .unicode_normalize(:nfd)
        .gsub(/\p{Mn}/, "")
        .downcase
        .gsub(/[^\p{L}\p{N}]+/, " ")
        .gsub(/\s+/, " ")
        .strip
    end

    def tokens_start_with?(tokens, prefix)
      prefix.length <= tokens.length && tokens.first(prefix.length) == prefix
    end

    def common_prefix_length(left, right)
      limit = [left.length, right.length].min
      index = 0
      index += 1 while index < limit && left[index] == right[index]
      index
    end

    def unknown_speaker?(speaker_key)
      UNKNOWN_SPEAKERS.include?(speaker_key)
    end

    def markdown(projection)
      meeting = projection[:started].fetch("meeting", {})
      stopped_meeting = projection[:stopped]&.fetch("meeting", {}) || {}
      title = meeting.fetch("title", "Google Meet").to_s.gsub(/[\r\n]+/, " ").strip
      participants = projection[:captions].map { |caption| caption["speaker"].to_s.strip }
        .reject { |speaker| UNKNOWN_SPEAKERS.include?(speaker.downcase) }
        .uniq
        .sort
      raw_relative = ".note-taker/raw/#{projection[:meeting_id]}.jsonl"

      lines = [
        "---",
        "id: #{yaml_string(projection[:meeting_id])}",
        "type: meeting",
        "source: google-meet-captions",
        "date: #{yaml_string(meeting["started_at"])}",
        "ended_at: #{yaml_string(stopped_meeting["ended_at"])}",
        "timezone: #{yaml_string(meeting["timezone"])}",
        "meeting_url: #{yaml_string(meeting["url"])}",
        "meeting_code: #{yaml_string(meeting["meeting_code"])}",
        "language: #{yaml_string(meeting["language"])}",
        "status: #{projection[:status]}",
        "caption_count: #{projection[:captions].length}",
        "participants:"
      ]

      if participants.empty?
        lines << "  []"
      else
        participants.each { |participant| lines << "  - #{yaml_string("[[#{participant}]]")}" }
      end

      lines.concat([
        "tags:",
        "  - meeting",
        "  - note-taker",
        "raw_log: #{yaml_string(raw_relative)}",
        "generated_at: #{yaml_string(Time.now.iso8601)}",
        "---",
        "",
        "# #{title}",
        "",
        "> [!info] Local Google Meet capture",
        "> Generated from captions. Keep the JSONL file as the original source.",
        "",
        "## Summary",
        "",
        "> [!note] Summary pending.",
        "",
        "## Decisions",
        "",
        "- ",
        "",
        "## Action items",
        "",
        "- [ ] ",
        "",
        "## Participants",
        ""
      ])

      if participants.empty?
        lines << "- Unknown"
      else
        participants.each { |participant| lines << "- [[#{participant}]]" }
      end

      lines.concat(["", "## Transcript", ""])
      if projection[:captions].empty?
        lines << "_No captions were captured._"
      else
        projection[:captions].each do |caption|
          lines << "### #{format_offset(caption["start_ms"])} — #{caption["speaker"] || "Unknown"}"
          lines << ""
          lines << caption["text"].to_s
          lines << ""
        end
      end

      lines.join("\n").rstrip + "\n"
    end

    def final_path(projection)
      File.join(@meetings_dir, filename(projection))
    end

    def draft_path(projection)
      File.join(@drafts_dir, filename(projection))
    end

    def filename(projection)
      meeting = projection[:started].fetch("meeting", {})
      started_at = parse_time(meeting["started_at"])
      date_prefix = started_at.localtime.strftime("%Y-%m-%d %H%M")
      title = sanitize_filename(meeting.fetch("title", "Google Meet"))
      suffix = Digest::SHA256.hexdigest(projection[:meeting_id].to_s)[0, 6]
      "#{date_prefix} - #{title} - #{suffix}.md"
    end

    def sanitize_filename(value)
      normalized = value.to_s.unicode_normalize(:nfc)
      normalized = normalized.gsub(/[\u0000-\u001f\/:*?"<>|]/, " ").gsub(/\s+/, " ").strip
      normalized = "Google Meet" if normalized.empty?
      normalized.each_char.first(90).join
    end

    def parse_time(value)
      Time.parse(value.to_s)
    rescue ArgumentError
      Time.now
    end

    def format_offset(milliseconds)
      total_seconds = [milliseconds.to_i / 1000, 0].max
      hours = total_seconds / 3600
      minutes = (total_seconds % 3600) / 60
      seconds = total_seconds % 60
      format("%02d:%02d:%02d", hours, minutes, seconds)
    end

    def yaml_string(value)
      value.nil? ? "null" : JSON.generate(value.to_s)
    end

    def atomic_write(path, content)
      temp_path = "#{path}.tmp-#{Process.pid}"
      File.open(temp_path, "w", 0o600) do |file|
        file.write(content)
        file.flush
        file.fsync
      end
      File.rename(temp_path, path)
    ensure
      FileUtils.rm_f(temp_path) if temp_path
    end
  end
end
