# frozen_string_literal: true

require "minitest/autorun"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "note_taker"

class DirectoryChooserTest < Minitest::Test
  FakeStatus = Struct.new(:ok, :exitstatus) do
    def success?
      ok
    end
  end

  def test_returns_a_normalized_posix_path
    runner = ->(*_args) { ["/Users/example/Meetings/\n", "", FakeStatus.new(true, 0)] }

    assert_equal(
      "/Users/example/Meetings",
      NoteTaker::DirectoryChooser.new(runner: runner).choose
    )
  end

  def test_returns_nil_when_the_user_cancels
    runner = ->(*_args) { ["", "execution error: User canceled. (-128)", FakeStatus.new(false, 1)] }

    assert_nil(NoteTaker::DirectoryChooser.new(runner: runner).choose)
  end

  def test_raises_when_the_picker_fails
    runner = ->(*_args) { ["", "osascript failed", FakeStatus.new(false, 1)] }

    error = assert_raises(IOError) { NoteTaker::DirectoryChooser.new(runner: runner).choose }
    assert_includes(error.message, "osascript failed")
  end
end
