# frozen_string_literal: true

require "fileutils"
require "json"
require "minitest/autorun"
require "stringio"
require "tmpdir"

$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))
require "note_taker"

class MarkdownRendererTest < Minitest::Test
  def setup
    @tmpdir = Dir.mktmpdir("note-taker-test")
    @meetings_dir = File.join(@tmpdir, "Meetings")
    @raw_dir = File.join(@meetings_dir, ".note-taker", "raw")
    @drafts_dir = File.join(@meetings_dir, ".note-taker", "drafts")
    @event_log = NoteTaker::EventLog.new(raw_dir: @raw_dir)
  end

  def teardown
    FileUtils.remove_entry(@tmpdir)
  end

  def test_imports_upserts_and_renders_obsidian_markdown
    fixture = File.expand_path("fixtures/sample-meeting.jsonl", __dir__)
    meeting_id = @event_log.import_file(fixture)
    renderer = NoteTaker::MarkdownRenderer.new(
      event_log: @event_log,
      meetings_dir: @meetings_dir,
      drafts_dir: @drafts_dir
    )

    path = renderer.render(meeting_id)
    markdown = File.read(path, encoding: "UTF-8")

    assert_equal("meet_1720972800000_demo", meeting_id)
    assert_includes(markdown, "# Planning Session")
    assert_includes(markdown, "status: complete")
    assert_includes(markdown, "caption_count: 2")
    assert_includes(markdown, '  - "[[Ana López]]"')
    assert_includes(markdown, "### 00:00:03 — Ana López")
    assert_includes(markdown, "Necesitamos revisar el contrato el viernes.")
    assert_includes(markdown, "  - note-taker")
    refute_includes(markdown, "Necesitamos revisar\n")
  end

  def test_rejects_unsafe_meeting_id
    error = assert_raises(ArgumentError) do
      @event_log.append("type" => "meeting_started", "meeting_id" => "../../escape")
    end
    assert_equal("Invalid meeting_id", error.message)
  end

  def test_incomplete_capture_can_be_finalized_as_interrupted
    @event_log.append(
      "event_id" => "start-incomplete",
      "type" => "meeting_started",
      "meeting_id" => "meet_incomplete",
      "meeting" => {
        "title" => "Junta interrumpida",
        "started_at" => "2026-07-14T17:00:00Z",
        "url" => "https://meet.google.com/demo",
        "timezone" => "America/Chihuahua"
      }
    )
    renderer = NoteTaker::MarkdownRenderer.new(
      event_log: @event_log,
      meetings_dir: @meetings_dir,
      drafts_dir: @drafts_dir
    )

    path = renderer.render("meet_incomplete", force_status: "interrupted")

    assert_equal(@meetings_dir, File.dirname(path))
    assert_includes(File.read(path, encoding: "UTF-8"), "status: interrupted")
  end

  def test_extension_id_is_stable
    assert_equal("cajomhnfojbdcomoagpongmigeebhcnl", NoteTaker::ExtensionIdentity.extension_id)
  end

  def test_native_host_has_a_dedicated_entrypoint
    assert_equal(
      File.join(NoteTaker::Config::PROJECT_ROOT, "bin", "note-taker-native-host"),
      NoteTaker::Config::NATIVE_EXECUTABLE
    )
  end

  def test_note_taker_is_the_visible_brand_without_changing_the_extension_id
    manifest_path = NoteTaker::Config::EXTENSION_MANIFEST
    manifest = JSON.parse(File.read(manifest_path, encoding: "UTF-8"))
    output = StringIO.new

    NoteTaker::CLI.new(["help"], out: output).run

    assert_equal("Note Taker — Meet Captions", manifest["name"])
    assert_equal("0.5.0", manifest["version"])
    assert_includes(manifest["permissions"], "storage")
    assert_includes(output.string, "Note Taker 0.5.0")
    assert_equal("cajomhnfojbdcomoagpongmigeebhcnl", NoteTaker::ExtensionIdentity.extension_id)
  end

  def test_note_taker_destination_environment_variable_is_supported
    original = ENV["NOTE_TAKER_MEETINGS_DIR"]
    ENV["NOTE_TAKER_MEETINGS_DIR"] = File.join(@tmpdir, "Custom Meetings")

    assert_equal(File.join(@tmpdir, "Custom Meetings"), NoteTaker::Config.meetings_dir)
  ensure
    ENV["NOTE_TAKER_MEETINGS_DIR"] = original
  end

  def test_collapses_fragmented_meet_revisions_from_the_same_speaker
    append_meeting_start("meet_fragmented")
    append_caption("meet_fragmented", "caption-1", 1, "Tú", "Hola que tal como estan. Que ser. Say.", 10_000, 20_000)
    append_caption("meet_fragmented", "caption-2", 2, "Tú", "Hola que tal como estan. Esta cabron. No nego que podema Sos.", 29_000, 29_000)
    append_caption("meet_fragmented", "caption-3", 3, "Tú", "Hola qué tal cómo están. Hay que revisar toda la arquitectura completa.", 40_000, 40_000)
    append_caption("meet_fragmented", "caption-4", 4, "Tú", "Hola qué tal cómo están. Hay que revisar toda la arquitectura completa. Eso es lo que tenemos que hacer.", 50_000, 50_000)

    markdown = render("meet_fragmented")

    assert_includes(markdown, "caption_count: 1")
    assert_equal(1, markdown.scan(/^### /).length)
    assert_includes(markdown, "Eso es lo que tenemos que hacer.")
    refute_includes(markdown, "Que ser. Say.")
  end

  def test_keeps_unrelated_utterances_from_the_same_speaker
    append_meeting_start("meet_distinct")
    append_caption("meet_distinct", "caption-1", 1, "Ana", "Primera idea", 1_000, 1_000)
    append_caption("meet_distinct", "caption-2", 2, "Ana", "Segunda idea", 8_000, 8_000)

    markdown = render("meet_distinct")

    assert_includes(markdown, "caption_count: 2")
    assert_equal(2, markdown.scan(/^### /).length)
  end

  private

  def append_meeting_start(meeting_id)
    @event_log.append(
      "event_id" => "start-#{meeting_id}",
      "type" => "meeting_started",
      "meeting_id" => meeting_id,
      "meeting" => {
        "title" => "Prueba de captions",
        "started_at" => "2026-07-14T17:00:00Z",
        "url" => "https://meet.google.com/demo",
        "timezone" => "America/Chihuahua"
      }
    )
  end

  def append_caption(meeting_id, id, sequence, speaker, text, start_ms, updated_ms)
    @event_log.append(
      "event_id" => "#{meeting_id}-#{id}",
      "type" => "caption_upsert",
      "meeting_id" => meeting_id,
      "caption" => {
        "id" => id,
        "sequence" => sequence,
        "speaker" => speaker,
        "text" => text,
        "start_ms" => start_ms,
        "updated_ms" => updated_ms
      }
    )
  end

  def render(meeting_id)
    renderer = NoteTaker::MarkdownRenderer.new(
      event_log: @event_log,
      meetings_dir: @meetings_dir,
      drafts_dir: @drafts_dir
    )
    File.read(renderer.render(meeting_id), encoding: "UTF-8")
  end
end
