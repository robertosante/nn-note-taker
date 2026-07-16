# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "tmpdir"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "note_taker"

class ConfigTest < Minitest::Test
  def setup
    @tmpdir = Dir.mktmpdir("note-taker-config-test")
    @original_config_path = ENV["NOTE_TAKER_CONFIG_PATH"]
    @original_meetings_dir = ENV["NOTE_TAKER_MEETINGS_DIR"]
    ENV["NOTE_TAKER_CONFIG_PATH"] = File.join(@tmpdir, "settings", "config.json")
    ENV.delete("NOTE_TAKER_MEETINGS_DIR")
  end

  def teardown
    ENV["NOTE_TAKER_CONFIG_PATH"] = @original_config_path
    ENV["NOTE_TAKER_MEETINGS_DIR"] = @original_meetings_dir
    FileUtils.remove_entry(@tmpdir)
  end

  def test_set_meetings_dir_creates_and_persists_the_folder
    destination = File.join(@tmpdir, "My Notes", "Meetings")

    result = NoteTaker::Config.set_meetings_dir(destination)

    assert_equal(destination, result)
    assert(File.directory?(destination))
    assert_equal(destination, NoteTaker::Config.meetings_dir)
    assert_equal(
      { "meetings_dir" => destination },
      JSON.parse(File.read(NoteTaker::Config.settings_path, encoding: "UTF-8"))
    )
  end

  def test_environment_variable_overrides_persisted_settings
    persisted = File.join(@tmpdir, "Persisted")
    override = File.join(@tmpdir, "Override")
    NoteTaker::Config.set_meetings_dir(persisted)
    ENV["NOTE_TAKER_MEETINGS_DIR"] = override

    assert_equal(override, NoteTaker::Config.meetings_dir)
  end

  def test_blank_directory_is_rejected
    assert_raises(ArgumentError) { NoteTaker::Config.set_meetings_dir("  ") }
  end
end
