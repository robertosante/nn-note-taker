# frozen_string_literal: true

require "base64"
require "digest"
require "json"

module NoteTaker
  module ExtensionIdentity
    module_function

    def extension_id(manifest_path = Config::EXTENSION_MANIFEST)
      manifest = JSON.parse(File.read(manifest_path, encoding: "UTF-8"))
      public_key = Base64.strict_decode64(manifest.fetch("key"))
      digest = Digest::SHA256.digest(public_key).bytes.first(16)
      digest.flat_map { |byte| [byte >> 4, byte & 15] }
        .map { |nibble| ("a".ord + nibble).chr }
        .join
    end
  end
end
