# reel: design brief

**What.** An app that streams films and series straight from torrents (what the engine fetches while you watch is a temporary cache; on computers, phones and tablets you can also save a film to watch offline, `offline-downloads.md`), with the torrent engine
built in (Rust core inside the app, no separate server). Platforms: Samsung Tizen TV first, then
macOS, Android / Android TV, iOS. One UI codebase in NSH.

**Who.** People at home who want to put on a film tonight without assembling TorrServer + Lampa +
MSX. Watching from a couch, 3 m from the screen, remote in hand, lights often dimmed. On the
phone: pick something on the way home, then watch on the TV.

**Primary job.** From "what to watch" to the film playing in as few presses as possible, and back
to where you stopped.

**Main screens.**
1. Home: continue watching, browse.
2. Film: description, available releases (quality, size, how many people share it), Watch.
3. Choose a file (for series and multi-file releases).
4. Player: playback, audio and subtitle tracks, buffer state.
5. Search.
6. Settings: sources, storage limit, language.

**Subject-specific material** (where distinctive visuals should come from): the film itself
(posters, stills, credits typography), the torrent swarm (pieces arriving, people sharing,
buffer ahead of playback), the home cinema evening (dim room, the screen as the only light).

**Constraints.** 10-foot rules on TV; works on Tizen web runtime (Chromium of the TV year);
NSH styling; dark by default but not the generic near-black.

**Demo content.** Public-domain films (Metropolis, Nosferatu, The General, Night of the Living
Dead, Charade, His Girl Friday, Sherlock Jr., Detour) so mockups and screenshots can be shared.
