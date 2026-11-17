# How reel works

1. **Browse.** Films, series and anime with their pictures, ratings, cast and episodes, from
   TMDB, AniList and Jikan. Titles and descriptions come in the language you pick.
2. **Your search source.** reel searches releases on a Torznab source you enter: your own
   Jackett, Prowlarr or any Torznab endpoint, or one rented from a partner
   ([partner-source.md](../design/partner-source.md)). You enter it on the first start or in
   Settings, on the TV or from a phone by scanning the QR code the TV shows. reel ships no source
   and no tracker of its own.
3. **Pick a release.** Of what the source finds, reel shows only what your device can play, and
   picks the one that starts fastest (well shared, a bitrate the swarm can carry; no 4K on a phone).
   You can always choose another.
4. **Play at once.** The built-in torrent engine (librqbit) fetches the start of the film first,
   then what is just ahead of where you watch. It keeps only a window of the film on disk, so a TV
   with little space is enough, and nothing has to download before it plays.
5. **Every format.** mpv plays it: any container and codec, the audio and subtitle tracks of the
   release, subtitles from separate files. On a Samsung TV the TV's own player does.
6. **On your device.** Settings and watch progress stay on the device. No accounts, no analytics.
