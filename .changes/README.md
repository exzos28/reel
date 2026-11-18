# Changes waiting for the next version

A PR that changes what the viewer sees adds one file here (any name, `.md`):

```md
---
bump: minor
---
Saved films play offline on Windows.
```

- `bump`: `patch` (fixes only, nothing new to learn), `minor` (something new: a screen, a platform, a
  setting) or `major` (`docs/releasing.md`).
- The text: one line for the viewer, as it goes into `CHANGELOG.md` and the release's notes. Plain
  words, no code names; the wording rules of the app apply (Save / Saved, never "Download").

A PR that changes the app (`app/`, `platforms/`, not only tests) without a file here fails the
`changeset` check; when the viewer sees no difference (a refactor, a test id), label it
`no-changeset`. `build/changes.py status` shows what is waiting; `build/release.sh` turns it into a
version (`docs/releasing.md`).
