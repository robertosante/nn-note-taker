# frozen_string_literal: true

require "json"
require "set"
require "time"

module NoteTaker
  class NativeHost
    MAX_MESSAGE_BYTES = 1_048_576
    DRAFT_EVERY_CAPTIONS = 10
    SETTINGS_TYPES = %w[settings_get settings_choose_directory].freeze

    def initialize(
      input: $stdin,
      output: $stdout,
      event_log: nil,
      renderer: nil,
      config: Config,
      directory_chooser: DirectoryChooser.new,
      storage_factory: nil
    )
      @input = input
      @output = output
      @input.binmode
      @output.binmode
      @config = config
      @directory_chooser = directory_chooser
      @storage_factory = storage_factory || method(:build_storage)
      @event_log, @renderer = initial_storage(event_log, renderer)
      @active_meetings = Set.new
      @caption_counts = Hash.new(0)
    end

    def run
      while (message = read_message)
        write_message(handle(message))
      end
    rescue StandardError => error
      warn("[Note Taker] Native host fatal: #{error.class}: #{error.message}")
    ensure
      finalize_interrupted_meetings
    end

    private

    def initial_storage(event_log, renderer)
      return @storage_factory.call unless event_log
      [event_log, renderer || MarkdownRenderer.new(event_log: event_log)]
    end

    def build_storage
      event_log = EventLog.new(raw_dir: @config.raw_dir)
      renderer = MarkdownRenderer.new(
        event_log: event_log,
        meetings_dir: @config.meetings_dir,
        drafts_dir: @config.drafts_dir
      )
      [event_log, renderer]
    end

    def read_message
      header = @input.read(4)
      return nil if header.nil? || header.empty?
      raise IOError, "Incomplete native message header" unless header.bytesize == 4

      length = header.unpack1("L")
      raise IOError, "Native message is too large" if length > MAX_MESSAGE_BYTES
      payload = @input.read(length)
      raise IOError, "Incomplete native message" unless payload&.bytesize == length
      JSON.parse(payload)
    end

    def write_message(message)
      payload = JSON.generate(message)
      @output.write([payload.bytesize].pack("L"))
      @output.write(payload)
      @output.flush
    end

    def handle(message)
      type = message.fetch("type")
      return handle_settings(message) if SETTINGS_TYPES.include?(type)

      handle_event(message)
    rescue StandardError => error
      warn("[Note Taker] Message rejected: #{error.class}: #{error.message}")
      {
        "ok" => false,
        "event_id" => message["event_id"],
        "request_id" => message["request_id"],
        "error" => error.message
      }
    end

    def handle_settings(message)
      request_id = message.fetch("request_id")
      type = message.fetch("type")
      cancelled = false

      if type == "settings_choose_directory"
        raise ArgumentError, "Finish the active meeting before changing folders" unless @active_meetings.empty?
        selected = @directory_chooser.choose
        if selected
          @config.set_meetings_dir(selected)
          @event_log, @renderer = @storage_factory.call
        else
          cancelled = true
        end
      end

      {
        "ok" => true,
        "request_id" => request_id,
        "type" => type,
        "cancelled" => cancelled,
        "settings" => { "meetings_dir" => @config.meetings_dir }
      }
    end

    def handle_event(event)
      event_id = event["event_id"]
      meeting_id = event.fetch("meeting_id")
      type = event.fetch("type")
      @event_log.append(event)

      note_path = case type
      when "meeting_started"
        @active_meetings << meeting_id
        @renderer.render(meeting_id)
      when "caption_upsert"
        @active_meetings << meeting_id
        @caption_counts[meeting_id] += 1
        @renderer.render(meeting_id) if (@caption_counts[meeting_id] % DRAFT_EVERY_CAPTIONS).zero?
      when "meeting_stopped"
        @active_meetings.delete(meeting_id)
        @renderer.render(meeting_id)
      else
        raise ArgumentError, "Unsupported event type: #{type}"
      end

      {
        "ok" => true,
        "event_id" => event_id,
        "meeting_id" => meeting_id,
        "type" => type,
        "note_path" => note_path
      }
    end

    def finalize_interrupted_meetings
      @active_meetings.each do |meeting_id|
        @event_log.append({
          "protocol_version" => 1,
          "event_id" => "host_interrupted_#{Process.pid}_#{Time.now.to_i}",
          "type" => "meeting_interrupted",
          "meeting_id" => meeting_id,
          "sent_at" => Time.now.iso8601
        })
        @renderer.render(meeting_id, force_status: "interrupted")
      rescue StandardError => error
        warn("[Note Taker] Could not finalize #{meeting_id}: #{error.message}")
      end
    end
  end
end
