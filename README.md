# Note Taker

Note Taker turns the live captions shown in Google Meet into Markdown files you can keep in an Obsidian vault. It consists of a Chrome extension and a small Ruby process that writes the files to disk.

There is no account, server, audio recording, or external API. Captions move from the Meet page to the local Ruby process through Chrome Native Messaging.

## Requirements

- macOS
- Google Chrome or a Chromium-based browser
- Ruby 2.6 or newer
- Google Meet captions turned on during the call

Node.js 18 or newer is only needed to run the JavaScript tests.

## Install

From the repository root:

```sh
chmod +x bin/note-taker bin/note-taker-native-host
bin/note-taker install
bin/note-taker doctor
```

Then open `chrome://extensions`:

1. Turn on **Developer mode**.
2. Click **Load unpacked**.
3. Select the `extension` directory from this repository.

The manifest contains a fixed public key, so unpacked installations use the same extension ID expected by the native host.

## Record a meeting

1. Join a Google Meet call and turn on captions.
2. Click **Start** in the Note Taker panel.
3. Leave captions on for the duration of the call.
4. Click **Finish** before closing the tab.

The panel shows `Saved locally` when the native host is receiving events. If the host is unavailable, the capture stays in memory and **Finish** downloads a `.jsonl` backup instead.

The live-notes area shows the six most recent consolidated captions with speaker names and timestamps. Drag the panel by its header to move it, or use the `−` button to keep only the compact status bar visible. Position and minimized state are saved in the current Chrome profile.

## Choose where files are saved

Open the panel settings with the `Aa` button and click **Choose folder**. The macOS picker lets you select an existing directory or create one. A folder cannot be changed while a meeting is being captured.

The same setting is available from the terminal:

```sh
bin/note-taker config --choose
bin/note-taker config --directory ~/Documents/Meetings
```

The default is `~/Documents/Note-Taker/Meetings`. The selected path is stored in `~/Library/Application Support/Note Taker/config.json`. For temporary or scripted use, `NOTE_TAKER_MEETINGS_DIR` overrides the saved setting.

## Files on disk

The selected directory contains one final Markdown file per meeting and a hidden working directory:

```text
Meetings/
├── 2026-07-15 0930 - Weekly planning - a1b2c3.md
└── .note-taker/
    ├── drafts/
    └── raw/
        └── meet_….jsonl
```

The Markdown includes Obsidian-friendly frontmatter, participants, timestamps, a transcript, and empty sections for a summary, decisions, and action items. The JSONL log is kept as the source record, so a note can be rendered again later:

```sh
bin/note-taker render MEETING_ID
```

To recover a browser backup:

```sh
bin/note-taker import ~/Downloads/meet_….jsonl
```

Importing the same backup more than once is safe; events are deduplicated by `event_id`.

## Caption revisions

Google Meet rewrites a caption several times while speech recognition is in progress. Note Taker keeps an active stream for each visible speaker and updates that speaker's current caption instead of saving every partial revision as a new paragraph.

The renderer applies the same cleanup to imported JSONL files. Raw events are never discarded, which makes the cleanup reproducible without treating the generated Markdown as the only copy.

## Display name

`Note Taker` is the default panel name. The `Aa` settings panel can change it without renaming files, protocol messages, or the native host. The preference is stored by Chrome and shared across Meet tabs in the same browser profile.

## Development

Run every Ruby and JavaScript test through Minitest:

```sh
rake test
```

`test/test_javascript.rb` starts Node's built-in test runner for the caption and settings models, so the default Rake task covers both languages. The JavaScript suites can also be run directly:

```sh
node --test test/test_caption_model.js test/test_settings_model.js
```

Pull requests use Conventional Commit titles and are checked in CI against Ruby 2.6 and 3.4. Release Please keeps `VERSION`, the extension manifest, `CHANGELOG.md`, tags, and GitHub Releases synchronized. See [CONTRIBUTING.md](CONTRIBUTING.md) for the version policy and release workflow.

Useful checks while changing the native integration:

```sh
bin/note-taker install
bin/note-taker doctor
```

Run `install` again after moving the repository because the Native Messaging manifest stores an absolute path to the Ruby entrypoint.

## Troubleshooting

If the panel says `Native host unavailable`:

1. Run `bin/note-taker install` from the current repository location.
2. Run `bin/note-taker doctor` and resolve any `MISSING` line.
3. Reload the unpacked extension from `chrome://extensions`.
4. Reload the Google Meet tab.

Chrome variants keep separate Native Messaging registrations, and browser profiles keep separate extension state. Use the `--browser` option shown by `bin/note-taker help` when you are not using standard Chrome.

## Limits

- Meet can change its page structure, which may require updating the caption selectors.
- Transcript quality is limited by the captions generated by Google Meet.
- Speakers with identical visible names cannot be distinguished reliably.
- The folder picker and Native Messaging installation currently target macOS.
- Summary, decision, and action-item sections are placeholders; no LLM is called.

Recording or retaining a transcript may require consent. Use it in line with the rules that apply to your meetings.

## License

Apache License 2.0. See [LICENSE](LICENSE).
