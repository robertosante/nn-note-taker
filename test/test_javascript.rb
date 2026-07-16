# frozen_string_literal: true

require "minitest/autorun"
require "open3"

class JavaScriptTest < Minitest::Test
  PROJECT_ROOT = File.expand_path("..", __dir__)

  def test_caption_model_node_suite
    assert_node_test("test/test_caption_model.js")
  end

  def test_settings_model_node_suite
    assert_node_test("test/test_settings_model.js")
  end

  private

  def assert_node_test(path)
    stdout, stderr, status = Open3.capture3("node", "--test", path, chdir: PROJECT_ROOT)
    assert(status.success?, "#{path} failed:\n#{stdout}\n#{stderr}")
  rescue Errno::ENOENT
    flunk("Node.js is required to run the JavaScript tests")
  end
end
