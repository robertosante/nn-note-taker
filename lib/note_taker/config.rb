# frozen_string_literal: true

require "fileutils"
require "json"

module NoteTaker
  module Config
    module_function

    NATIVE_HOST_NAME = "app.note_taker.meet_captions"
    PROJECT_ROOT = File.expand_path("../..", __dir__)
    EXTENSION_DIR = File.join(PROJECT_ROOT, "extension")
    EXTENSION_MANIFEST = File.join(EXTENSION_DIR, "manifest.json")
    EXECUTABLE = File.join(PROJECT_ROOT, "bin", "note-taker")
    NATIVE_EXECUTABLE = File.join(PROJECT_ROOT, "bin", "note-taker-native-host")
    DEFAULT_MEETINGS_DIR = "~/Documents/Note-Taker/Meetings"

    def settings_path
      File.expand_path(
        ENV.fetch(
          "NOTE_TAKER_CONFIG_PATH",
          "~/Library/Application Support/Note Taker/config.json"
        )
      )
    end

    def settings
      return {} unless File.file?(settings_path)
      JSON.parse(File.read(settings_path, encoding: "UTF-8"))
    rescue JSON::ParserError, SystemCallError
      {}
    end

    def meetings_dir
      configured = ENV["NOTE_TAKER_MEETINGS_DIR"] || settings["meetings_dir"]
      File.expand_path(configured || DEFAULT_MEETINGS_DIR)
    end

    def set_meetings_dir(path)
      value = path.to_s.strip
      raise ArgumentError, "Choose a folder first" if value.empty?

      destination = File.expand_path(value)
      FileUtils.mkdir_p(destination, mode: 0o700)
      write_settings(settings.merge("meetings_dir" => destination))
      destination
    end

    def raw_dir
      File.join(meetings_dir, ".note-taker", "raw")
    end

    def drafts_dir
      File.join(meetings_dir, ".note-taker", "drafts")
    end

    def ensure_directories!
      FileUtils.mkdir_p([meetings_dir, raw_dir, drafts_dir], mode: 0o700)
    end

    def native_host_directory(browser = "chrome")
      base = File.expand_path("~/Library/Application Support")
      case browser
      when "chrome"
        File.join(base, "Google", "Chrome", "NativeMessagingHosts")
      when "chromium"
        File.join(base, "Chromium", "NativeMessagingHosts")
      when "chrome-beta"
        File.join(base, "Google", "Chrome Beta", "NativeMessagingHosts")
      when "chrome-canary"
        File.join(base, "Google", "Chrome Canary", "NativeMessagingHosts")
      else
        raise ArgumentError, "Unsupported browser: #{browser}"
      end
    end

    def native_host_manifest(browser = "chrome")
      File.join(native_host_directory(browser), "#{NATIVE_HOST_NAME}.json")
    end

    def write_settings(payload)
      FileUtils.mkdir_p(File.dirname(settings_path), mode: 0o700)
      temporary = "#{settings_path}.tmp-#{Process.pid}"
      File.open(temporary, "w", 0o600) do |file|
        file.write(JSON.pretty_generate(payload) + "\n")
        file.flush
        file.fsync
      end
      File.rename(temporary, settings_path)
    ensure
      FileUtils.rm_f(temporary) if temporary
    end
    private_class_method :write_settings
  end
end
