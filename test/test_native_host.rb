# frozen_string_literal: true

require "minitest/autorun"
require "stringio"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "note_taker"

class NativeHostTest < Minitest::Test
  class FakeConfig
    attr_reader :meetings_dir

    def initialize(meetings_dir = "/tmp/Meetings")
      @meetings_dir = meetings_dir
    end

    def set_meetings_dir(path)
      @meetings_dir = path
    end

    def raw_dir
      File.join(@meetings_dir, ".note-taker", "raw")
    end

    def drafts_dir
      File.join(@meetings_dir, ".note-taker", "drafts")
    end
  end

  class FakeChooser
    attr_reader :calls

    def initialize(result)
      @result = result
      @calls = 0
    end

    def choose
      @calls += 1
      @result
    end
  end

  class FakeEventLog
    attr_reader :events

    def initialize
      @events = []
    end

    def append(event)
      @events << event
    end
  end

  class FakeRenderer
    def render(meeting_id, force_status: nil)
      "/tmp/#{meeting_id}-#{force_status || "current"}.md"
    end
  end

  def test_get_settings_returns_the_current_directory
    host, = build_host

    response = host.send(:handle, settings_message("settings_get"))

    assert(response["ok"])
    assert_equal("request-1", response["request_id"])
    assert_equal("/tmp/Meetings", response.dig("settings", "meetings_dir"))
  end

  def test_choose_directory_updates_config_and_rebuilds_storage
    chooser = FakeChooser.new("/tmp/Chosen Meetings")
    host, config, storage_calls = build_host(chooser: chooser)

    response = host.send(:handle, settings_message("settings_choose_directory"))

    assert(response["ok"])
    refute(response["cancelled"])
    assert_equal("/tmp/Chosen Meetings", config.meetings_dir)
    assert_equal(2, storage_calls.call)
  end

  def test_canceling_the_picker_keeps_the_current_directory
    chooser = FakeChooser.new(nil)
    host, config, storage_calls = build_host(chooser: chooser)

    response = host.send(:handle, settings_message("settings_choose_directory"))

    assert(response["ok"])
    assert(response["cancelled"])
    assert_equal("/tmp/Meetings", config.meetings_dir)
    assert_equal(1, storage_calls.call)
  end

  def test_directory_cannot_change_during_an_active_meeting
    chooser = FakeChooser.new("/tmp/Other")
    host, = build_host(chooser: chooser)
    host.send(
      :handle,
      "type" => "meeting_started",
      "event_id" => "event-1",
      "meeting_id" => "meet-active"
    )

    response = host.send(:handle, settings_message("settings_choose_directory"))

    refute(response["ok"])
    assert_includes(response["error"], "Finish the active meeting")
    assert_equal(0, chooser.calls)
  end

  private

  def settings_message(type)
    { "protocol_version" => 1, "request_id" => "request-1", "type" => type }
  end

  def build_host(chooser: FakeChooser.new(nil))
    config = FakeConfig.new
    calls = 0
    storage_factory = lambda do
      calls += 1
      [FakeEventLog.new, FakeRenderer.new]
    end
    host = NoteTaker::NativeHost.new(
      input: StringIO.new,
      output: StringIO.new,
      config: config,
      directory_chooser: chooser,
      storage_factory: storage_factory
    )
    [host, config, -> { calls }]
  end
end
