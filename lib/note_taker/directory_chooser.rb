# frozen_string_literal: true

require "open3"

module NoteTaker
  class DirectoryChooser
    SCRIPT = <<~APPLESCRIPT.freeze
      POSIX path of (choose folder with prompt "Choose where Note Taker should save meeting notes")
    APPLESCRIPT

    def initialize(runner: Open3.method(:capture3))
      @runner = runner
    end

    def choose
      output, error, status = @runner.call("/usr/bin/osascript", "-e", SCRIPT)
      return nil if !status.success? && cancelled?(error)
      raise IOError, "The folder picker could not be opened: #{error.to_s.strip}" unless status.success?

      normalize_path(output)
    end

    private

    def cancelled?(error)
      error.to_s.match?(/cancelled|canceled|-128/i)
    end

    def normalize_path(value)
      path = value.to_s.strip
      path = path[0...-1] if path.length > 1 && path.end_with?(File::SEPARATOR)
      raise IOError, "The folder picker returned an empty path" if path.empty?
      path
    end
  end
end
