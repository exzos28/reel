# Changelog

What each version of reel changed for the viewer. Earlier versions: GitHub Releases.

## 0.7.0 (2026-11-22)

- iPhone and iPad: install reel with AltStore or SideStore. Add the source https://github.com/exzos28/reel/releases/latest/download/altstore.json once, and its updates come from it.
- Samsung TV: a seek the TV answers late no longer ends the film with an error, and the audio track you picked is set as the film starts.
- Samsung TV: the player no longer stops with "invalid state" when it is paused, resumed or closed at a moment the TV's player does not take it, or when the next film opens.
- At the end of a catalog the grey cards for the next titles fill the last row first, and the titles take their places when they arrive.
- The bar under a starting film moves steadily from Play to the picture: it counts the search, the torrent, the first person connected and the bytes the player needs first, and it is full only when the picture shows.
- The watched bar under Resume follows the button's rounded corner.
- On a Mac, Windows and Linux the pointer turns into a hand over buttons, cards and rows.
- A film starts without status words: the title, the release and the bar of its start; words show only when something needs you (an error, no release, no space).
- Play and Resume are red, in the colour of the logo, with white words: on Home and on a film's or show's page, the other releases' arrow and the release line inside it too.
- The picture at the top of Home and of a film's or show's page is sharp on phones, tablets and TVs: it loads in the size the screen shows.

## 0.6.0 (2026-11-22)

- Android phones: the app stays upright and the player shows the film sideways inside it, as on an iPhone: Rotate turns it, it follows the phone while auto-rotate is on, and the scrubber and the swipe down to close work sideways.
- Android TV: set the search source up on your phone. Scan the QR code in the setup or in Settings, as on a Samsung TV.
- Android TV: reel shows in the TV's apps with its banner and the remote's OK works; Back while a film waits for the stream no longer freezes the app, the player no longer stays on Starting after another app was in front, and a link from the bot offers its search source on Android.
- Films and series play in your audio language: the app's language at first, then the language of the last track you picked. A series keeps the dub you picked across its episodes, and Settings has Audio language to change it or go back to the app's language.
- Filters: a filter sheet closes once you pick, Clear resets all filters at once, and Anime is filtered by format (series, movies, OVA and specials) instead of country.
- iPhone: the player shows the film sideways at once without the screen turning, Rotate turns it smoothly and closing it leaves Home upright; it follows the phone when rotation is unlocked, and the home indicator fades while it plays sideways. A remote's media keys (rewind, play/pause, fast forward) work in the player.
- On a phone the tabs at the bottom are Home, Search, Saved and Settings; what to watch (All, Movies, Series, Cartoons, Anime) is a row of tabs at the top of Home.
- The player's scrubber and volume follow a drag: grab the thumb or the bar and slide it, with a finger or the mouse; the film jumps once you let go.
- Search: a clear button in the field, what is trending before your first search, recent searches that search at once with the keyboard up, and a hint when nothing is found.
- iPad: Saved in the top row with its progress, the app opens on Saved without a network, a narrow window gets the phone layout, the top row turns solid as the page scrolls under it and shows the tabs' names where they fit; no Rotate in the player.
- A title's cast opens each person's page with the films and series they are in. On a series Play says which episode it starts ("Play S1:E1", "Resume S2:E3 · 14:30"), and an episode you started shows how much is left and a bar on its picture. On a phone or a tablet a tap on the description shows it whole.
- About shows reel's license and a link to its source code; links are titled by name.
- Android: closing the player lets go of the film at once, also while it is still starting.
- Android TV: the remote's Pause key pauses the film.
- A film starts with a smaller cache when the free space has shrunk below the chosen playback buffer, instead of refusing to play.
- Cards say one thing under their names (the year on Movies, the kind elsewhere) with the rating as a small star; "3 seasons" in sentence case.
- On a phone, Home's category tabs slide away with the page when a film opens and come back with it on Back, instead of vanishing at once.
- On a phone, Home's category tabs move smoothly: the red line slides to the chosen tab, the row slides to show it, and the labels fade.
- Phones and tablets: closing the player shows the page you played from at once, as you left it, instead of the tab's first page with that page sliding back in; a tab you return to shows its page at once too, and the first swipe back there works.
- On macOS, Windows and Linux the window can no longer be made smaller than 960 by 600, where the layout still fits.
- An episode picked in the player's Episodes panel plays.
- A film's releases are no longer labelled "season pack".
- The ratings, votes and genres over a hero picture on a phone read clearly: a soft shade behind the text and brighter grey.
- Home's top film shows the release it plays right after the app starts, and no empty line when there is none.
- Home no longer repeats its top title on the shelves under it: Continue watching goes on from the next one.
- Another episode, Up next or a closed player: the last one's sound stops at once and the next one starts after it. On iPhone and iPad closing the player returns at once, also while the film waits for the stream.
- On a phone or a tablet Loading animation is a row of Settings instead of a page of its own.
- A film starts without the blinking reel: the title, the release, what it does and the bar of its start. Loading animation is None by default, and the dinosaur stays a choice.
- One name per action everywhere: Add to list / In list, Playback buffer, Check.
- On a tablet the setup's "Get a ready source in Telegram" button sits under its QR code instead of running off the screen.
- On a phone or a tablet the search source shows the Telegram button first, without the QR code meant for a TV.
- A person's page says the year and the part they played under each title; a film's runtime shows once, in its hero.
- On a TV, the address to open on your phone (beside Settings and the first-run setup) sits on a line of its own and is never broken in the middle.
- On a phone the Movies, Series, Cartoons and Anime pages start with their content: the tabs already say where you are.
- Phone: panels from the bottom follow the finger and settle with its speed; a long list opens halfway and grows when dragged up, a short one is as tall as its rows.
- On a phone, sheets are as tall as their list and grow when dragged up; their title and close button stay in place while the list scrolls, and the last row clears the home indicator.
- Phone: a scrolled film or series page keeps a bar at the top with Back, its name and Add to Watchlist, and nothing runs under the clock.
- iPhone player: it turns sideways as soon as it opens, so a film opened with the phone upright no longer plays without a picture; 4:3 films play sideways too, and only a vertical clip turns back upright.
- iPhone and iPad player: turning the device, Rotate, split view and resizing keep the picture, the sound and the place; the picture keeps its shape and is sharp both ways.
- iPhone player: "Waiting for the stream" sits in the bottom row between the times instead of over the Pause button, and the controls stay up while it waits.
- Play opens the player at once, even while the release is still being searched: it says "Looking for a release" and starts when one is found. If your search source does not answer, the drawer to fix it opens; if it finds nothing, the player says so.
- iPhone and iPad player: the next episode (Up next or from Episodes) no longer leaves a blank screen, the phone's secondary buttons move to the top so the bottom keeps only the timeline, subtitles stay clear of the buttons and sit by the picture when the phone is upright, the app turns upright again after the player and the player keeps its orientation after the background, no "Waiting for the stream" on return when the film is at hand, the scrubber stays under the finger, a saved film has no empty Release list, and VoiceOver reaches every control.
- On a phone the player's audio, subtitles and release choices open in a sheet with one list at a time, and the episodes in a sheet of their own that no longer covers the close button.
- In the player on a tablet the episodes panel has a close button, the season shown is marked with a check, and the tracks panel's close button no longer sits on a check.
- On a phone a wide film starts sideways, with Play and ±10 s in the middle of the picture and the controls clear of the home indicator; a wait mid-film says "Waiting for the stream" instead of showing the loader over the picture.
- Every button and row reacts when you press it.
- On a phone or a tablet Play no longer picks a huge release by itself (up to 1080p and about 5 GB an hour); Save shows its size, does not start when the film does not fit and offers a smaller release, and the Save sheet of a series shows the free space.
- The release you choose for a film or a season stays after a restart, Resume goes on in the release you watched, and on a Full HD screen without HDR the app picks a 1080p release that screen shows rather than 4K HDR.
- The releases list says how each release starts ("Starts fast", "Needs 21 Mbit/s internet") on phones, tablets and computers too.
- Each release in the list says its audio languages and voice-over, video codec and HDR, size and the people sharing, with its full name under them, and a screen reader reads all of it.
- The Save drawer's rows are easier to tap, and its seasons run to the edge so it shows there are more.
- Saved films go on at once after the app restarts, instead of checking the whole file first.
- Saved says how long a film still takes to save, the phone's Saved tab shows the progress while something saves, and an empty Saved offers Browse films.
- Search finds films for common words too (“night” showed only series), and a row that did not load says so, with Try again.
- On a phone or a tablet Search opens without the keyboard, so what is trending stays in view; the clear button is easier to tap.
- The first-run setup has Back on its later steps, says what a search source is at the top, shows “Checking…” and then “Connected” with one Finish button, keeps its main button at the bottom on phones, and More languages lists only the languages not already shown.
- In the first-run setup the focus starts on the choice in effect (the recommended buffer), not the first one.
- Subtitles come on by themselves only in a language you read, are sized to the picture (smaller on a tablet or phone held upright), keep to two lines and stay above the player's controls.
- On a tablet search results are a grid of cards with Show all, and the Saved screen shows what is ready to watch as cards (hold one to remove it); its buttons are easier to tap.
- On a tablet held sideways a show's episodes run in two columns, About and Details sit side by side, and Settings is a column in the middle.
- On a tablet, short choices (a setting, a filter, the order) open as a small popover by what was pressed, and the panels no longer start under the status bar.
- On iPad Settings is a section of its own beside Saved: each tab opens on its own page again instead of a Settings page left in it, and Back from Settings returns where you were. In a narrow iPad window Settings is a tab, as on a phone. Choosing the current tab again goes back to its first page again.
- A title's page puts the release inside Play, with ⌄ beside it for the other releases; on a phone Save and Trailer sit side by side under it, the people sharing show as a number, and the Watchlist is a heart.
- iPhone and iPad: a person opened from a film on Home shows their name and photo, swipe back works at the first try after switching tabs, Saved and Settings on iPad have Back to where they were opened from, an iPad window keeps normal margins, and the releases sheet no longer goes invisible when the window is resized.
- Samsung TV: Back on a page scrolled down brings it back to its top with the menu in view, and Try again on a search that got no answer asks again.
- Android TV no longer offers Save and Saved: saving films is for phones, tablets and computers.
- TV remote: the search source's address and key can be typed with the remote (in the setup and in Settings), OK always acts on what the focus ring is on, Back to a page shows the card you left in view, holding Down in a grid keeps going while more titles load, and the hero's Details button says what it does.
- Text on a TV is larger and easier to read from the sofa.
- On Windows and Linux the mouse wheel over a row of cards or an open preview scrolls the page.

## 0.5.0 (2026-11-20)

- reel speaks your language: English, Русский, Українська, Polski, Deutsch, Français, Español, Italiano, Português (Brasil), Türkçe, 日本語 and 中文. The Language setting now sets the language of the app too, and a new install starts in the device's language when reel has it.
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
