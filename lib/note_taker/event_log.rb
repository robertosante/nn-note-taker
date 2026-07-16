# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"

module NoteTaker
  class EventLog
    MEETING_ID_PATTERN = /\A[a-zA-Z0-9_.-]+\z/

    def initialize(raw_dir: Config.raw_dir)
      @raw_dir = raw_dir
      FileUtils.mkdir_p(@raw_dir, mode: 0o700)
    end

    def append(event)
      meeting_id = validate_meeting_id!(event.fetch("meeting_id"))
      path = path_for(meeting_id)
      File.open(path, File::WRONLY | File::APPEND | File::CREAT, 0o600) do |file|
        file.flock(File::LOCK_EX)
        file.puts(JSON.generate(event))
        file.flush
        file.fsync
      ensure
        file.flock(File::LOCK_UN)
      end
      path
    end

    def events(meeting_id)
      path = path_for(validate_meeting_id!(meeting_id))
      return [] unless File.file?(path)

      parse_lines(path, skip_invalid: true)
    end

    def import_file(source_path)
      incoming = parse_lines(source_path, skip_invalid: false)
      raise ArgumentError, "The backup is empty" if incoming.empty?

      meeting_ids = incoming.map { |event| event["meeting_id"] }.compact.uniq
      raise ArgumentError, "The backup must contain exactly one meeting" unless meeting_ids.length == 1

      meeting_id = validate_meeting_id!(meeting_ids.first)
      merged = deduplicate(events(meeting_id) + incoming)
      atomic_write(path_for(meeting_id), merged.map { |event| JSON.generate(event) }.join("\n") + "\n")
      meeting_id
    end

    def meeting_ids
      Dir.glob(File.join(@raw_dir, "*.jsonl")).sort.map { |path| File.basename(path, ".jsonl") }
    end

    def path_for(meeting_id)
      File.join(@raw_dir, "#{validate_meeting_id!(meeting_id)}.jsonl")
    end

    private

    def validate_meeting_id!(meeting_id)
      value = meeting_id.to_s
      raise ArgumentError, "Invalid meeting_id" unless MEETING_ID_PATTERN.match?(value)
      value
    end

    def deduplicate(events)
      seen = {}
      events.each_with_object([]) do |event, result|
        identity = event["event_id"] || Digest::SHA256.hexdigest(JSON.generate(event))
        next if seen[identity]
        seen[identity] = true
        result << event
      end
    end

    def parse_lines(path, skip_invalid:)
      File.foreach(path, chomp: true).each_with_object([]) do |line, result|
        next if line.strip.empty?
        result << JSON.parse(line)
      rescue JSON::ParserError => error
        raise unless skip_invalid
        warn("[Note Taker] Ignored an invalid JSONL line: #{error.message}")
      end
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
