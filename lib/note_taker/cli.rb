# frozen_string_literal: true

require "fileutils"
require "json"
require "optparse"

module NoteTaker
  class CLI
    BROWSERS = %w[chrome chromium chrome-beta chrome-canary].freeze

    def initialize(argv, out: $stdout, err: $stderr)
      @argv = argv.dup
      @out = out
      @err = err
    end

    def run
      command = @argv.shift || "help"
      case command
      when "install" then install
      when "uninstall" then uninstall
      when "doctor" then doctor
      when "config" then configure
      when "host" then NativeHost.new.run
      when "import" then import_backup
      when "render" then render
      when "version", "--version", "-v" then @out.puts(NoteTaker::VERSION)
      when "help", "--help", "-h" then help
      else
        raise OptionParser::InvalidOption, "Unknown command: #{command}"
      end
      0
    rescue OptionParser::ParseError, ArgumentError, KeyError => error
      @err.puts("Error: #{error.message}")
      @err.puts("Run `#{File.basename($PROGRAM_NAME)} help` for usage.")
      1
    end

    private

    def install
      browser = parse_browser_option
      Config.ensure_directories!
      manifest_path = Config.native_host_manifest(browser)
      FileUtils.mkdir_p(File.dirname(manifest_path), mode: 0o700)

      extension_id = ExtensionIdentity.extension_id
      manifest = {
        "name" => Config::NATIVE_HOST_NAME,
        "description" => "Saves Google Meet captions as local Markdown files",
        "path" => Config::NATIVE_EXECUTABLE,
        "type" => "stdio",
        "allowed_origins" => ["chrome-extension://#{extension_id}/"]
      }
      File.write(manifest_path, JSON.pretty_generate(manifest) + "\n", mode: "w", perm: 0o600)

      @out.puts("Note Taker is installed.")
      @out.puts("  Extension ID: #{extension_id}")
      @out.puts("  Extension:    #{Config::EXTENSION_DIR}")
      @out.puts("  Native host:  #{manifest_path}")
      @out.puts("  Meeting notes: #{Config.meetings_dir}")
    end

    def uninstall
      browser = parse_browser_option
      manifest_path = Config.native_host_manifest(browser)
      FileUtils.rm_f(manifest_path)
      @out.puts("Removed native host: #{manifest_path}")
      @out.puts("Meeting notes and raw logs were not deleted.")
    end

    def doctor
      browser = parse_browser_option
      checks = {
        "Ruby 2.6 or newer" => Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("2.6"),
        "Extension manifest" => File.file?(Config::EXTENSION_MANIFEST),
        "CLI executable" => File.executable?(Config::EXECUTABLE),
        "Native host executable" => File.executable?(Config::NATIVE_EXECUTABLE),
        "Meeting notes directory" => File.directory?(Config.meetings_dir),
        "Native host registration" => File.file?(Config.native_host_manifest(browser))
      }

      checks.each { |label, ok| @out.puts("#{ok ? "OK" : "MISSING"}  #{label}") }
      @out.puts("Extension ID: #{ExtensionIdentity.extension_id}")
      @out.puts("Meeting notes: #{Config.meetings_dir}")
      raise ArgumentError, "One or more checks need attention" unless checks.values.all?
    end

    def configure
      directory = nil
      choose = false
      parser = OptionParser.new do |options|
        options.on("--directory PATH", "Save meeting notes in PATH") { |value| directory = value }
        options.on("--choose", "Open the macOS folder picker") { choose = true }
      end
      parser.parse!(@argv)
      raise ArgumentError, "Use either --directory or --choose, not both" if directory && choose

      selected = choose ? DirectoryChooser.new.choose : directory
      if choose && !selected
        @out.puts("Folder selection canceled. Nothing changed.")
      elsif selected
        @out.puts("Meeting notes: #{Config.set_meetings_dir(selected)}")
      else
        @out.puts("Meeting notes: #{Config.meetings_dir}")
      end
    end

    def import_backup
      source = @argv.shift
      raise ArgumentError, "Pass the path to a .jsonl backup" unless source
      raise ArgumentError, "File not found: #{source}" unless File.file?(source)

      Config.ensure_directories!
      event_log = EventLog.new
      meeting_id = event_log.import_file(source)
      complete = event_log.events(meeting_id).any? { |event| event["type"] == "meeting_stopped" }
      force_status = complete ? nil : "interrupted"
      path = MarkdownRenderer.new(event_log: event_log).render(meeting_id, force_status: force_status)
      @out.puts("Imported backup: #{path}")
    end

    def render
      Config.ensure_directories!
      event_log = EventLog.new
      renderer = MarkdownRenderer.new(event_log: event_log)
      requested = @argv.shift
      meeting_ids = requested ? [requested] : event_log.meeting_ids
      raise ArgumentError, "No captures found" if meeting_ids.empty?

      meeting_ids.each { |meeting_id| @out.puts(renderer.render(meeting_id)) }
    end

    def parse_browser_option
      browser = "chrome"
      parser = OptionParser.new do |options|
        options.on("--browser NAME", BROWSERS, "Browser: #{BROWSERS.join(", ")}") { |value| browser = value }
      end
      parser.parse!(@argv)
      browser
    end

    def help
      @out.puts <<~HELP
        Note Taker #{NoteTaker::VERSION}

        Usage:
          note-taker install [--browser chrome]
          note-taker doctor [--browser chrome]
          note-taker config [--directory PATH | --choose]
          note-taker import PATH.jsonl
          note-taker render [MEETING_ID]
          note-taker uninstall [--browser chrome]

        The `host` command is reserved for Chrome Native Messaging.
        Meeting notes: #{Config.meetings_dir}
      HELP
    end
  end
end
