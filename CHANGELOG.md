# Changelog

What each version of reel changed for the viewer. Earlier versions: GitHub Releases.

## 0.5.0 (2026-11-20)

- reel speaks Russian. The Language setting now sets the language of the app too, and a new install starts in the device's language when reel has it.
- Episodes of anime packs play the right file: openings, endings and specials beside them are skipped, and the episode number in names like "Title - 05 [1080p]" or "[001-053 из 500]" is read in any language.
- An episode is found in a release whose files are named with underscores ("s01e01_Pilot.avi").
- An episode missing from its season's release now finds the season packs that hold it, and releases no longer match a show by a word in their genre list.
- On Home the big picture at the top stays on what you watched last, wherever you move along the shelves.
- Seeks in MP4 films fetch exactly the part the player reads too, as they do in MKV.
- A show released as one pack of all its seasons ("S1E1-327 of 327") or of several seasons numbered through plays every season it holds, not only the first.
- Releases are found whatever the app's language: reel also searches by the English title and, for anime, the romaji one.
- A season without its own date in TMDB shows the year its first episode aired, or no year, instead of the show's first year.
- While a seek waits for its part of the film, the picture holds still instead of playing on under the loader.
- A seek downloads that part of the film first and only then moves the picture there, so the app keeps answering meanwhile (on a TV it froze until the part came). reel finds the part in the film's own index (MKV), so it fetches exactly what the player reads. The loader during a stall or a seek shows on a darkened picture and breathes like the title does at the start.
- Settings has an Interface page for Menu position and Loading animation. The blinking reel is the loader by default.
- On the first setup step, the remote moves through More languages and picks one (the focus stayed on English).
- Titles and descriptions read better: long titles are tracked tighter and do not end a line on a short word, a hero's description ends on a whole sentence, genres share one case, and an anime no longer lists "Animation".

## 0.4.0 (2026-11-19)

- Seeking with the remote no longer makes the scrubber jump back while the TV catches up: presses move the scrubber, the player seeks once they stop, and a held arrow goes faster.
- In the player's episode list, the seasons scroll sideways in one row and the list follows the episode in focus.
- The player's buttons no longer show a cut-off caption above the focused one.
- The last setup step on a TV no longer pushes Skip off the screen.
- On a TV, the first-run setup finishes and does not come back on the next start.
- On a Samsung TV, films and episodes show their picture again (only the sound played).

## 0.3.0 (2026-11-18)

- Search can clear its history of recent searches.
- On a computer, reel looks and scrolls better: pages sit in a column in the middle of a wide window, scrolling is smoother, resting the pointer on a card opens a preview, Home and a title's page have a new picture at the top, and the window bar is new.
- Saved films on Windows no longer stay on "Starting" for ever; when the player cannot show the picture, it says so.
