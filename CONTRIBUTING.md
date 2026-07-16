# Contributing

## Development workflow

Create a branch from `main`, make a focused change, and run:

```sh
rake test
```

Open a pull request with a Conventional Commit title. Merge it with squash merge so the PR title becomes the commit Release Please reads from `main`.

Common title types:

```text
fix(captions): avoid duplicated revisions
feat(ui): add compact capture mode
docs: clarify native host installation
test(storage): cover a canceled folder picker
feat(protocol)!: change the native message schema
```

The accepted types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.

## Version policy

Note Taker follows Semantic Versioning. Its compatibility surface includes:

- CLI commands and options
- Native Messaging event and settings payloads
- Markdown frontmatter and raw JSONL format
- configuration paths and Chrome storage preferences
- documented capture and backup behavior

While the project is below `1.0.0`:

- `fix` produces a patch release, such as `0.5.0` to `0.5.1`.
- `feat` produces a minor release, such as `0.5.1` to `0.6.0`.
- a breaking change also produces a minor release and must include migration notes.

After `1.0.0`, breaking changes produce a major release.

Do not edit `VERSION`, `extension/manifest.json`, or `CHANGELOG.md` for ordinary feature and fix pull requests. Release Please updates them together in its release pull request.

## Release flow

1. Merge Conventional Commit pull requests into `main` using squash merge.
2. Release Please keeps a release pull request updated with the next version and changelog.
3. Review the version and notes in that pull request.
4. Merge it to create the `vX.Y.Z` tag and GitHub Release.

Chrome's manifest accepts numeric versions only. Pre-release labels belong in GitHub Releases or the optional manifest `version_name`, not in the manifest `version` field.
