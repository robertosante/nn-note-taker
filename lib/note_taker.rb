# frozen_string_literal: true

require_relative "note_taker/config"
require_relative "note_taker/directory_chooser"
require_relative "note_taker/extension_identity"
require_relative "note_taker/event_log"
require_relative "note_taker/markdown_renderer"
require_relative "note_taker/native_host"
require_relative "note_taker/cli"

module NoteTaker
  VERSION = "0.5.0"
end
