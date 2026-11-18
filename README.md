# Album Sorter

**Live website:** [Album Sorter](https://amylatifa.github.io/album-sorter/)

Album Sorter is a web application that helps music fans rank ten of their favorite albums through head-to-head comparisons. Users select the albums they want to compare, choose their preferred album in each matchup, and receive a definitive ranking from first to tenth place. The final list includes album artwork, titles, and artist names and can be saved as an image or shared with friends.

## Project Background

I originally created Album Sorter as a personal project to combine two of my interests: computer science and music technology. As someone who studies both subjects, I wanted to build something that music fans could use to explore their own tastes and compare their favorite albums with other people.

The project was inspired by the Pop Sorter on Tumblr. Unlike a song-ranking tool, Album Sorter focuses on albums that the user chooses. It includes cover art and produces a strict ranking, so no two albums share the same position.

My first version was built with HTML, CSS, and JavaScript and used the iTunes Search API. I later rebuilt it with **React, TypeScript, and Vite** to improve the interface, expand album search results, and make it easier to save and share rankings.

## Features

- **Choose ten albums:** Search by album title, artist, or both, then build a list of exactly ten releases.
- **Expanded album search:** Combine results from the iTunes Search API and MusicBrainz into one list, removing duplicate album-and-artist matches.
- **Manual album entry:** Add an album by title and artist when it is missing from both catalogs.
- **Head-to-head comparisons:** Click the album you prefer, or press `1` or `2` on your keyboard.
- **Undo and restart:** Reverse your last decision with the Undo button or the `U` key, or start a new ranking at any time.
- **Definitive top ten:** View all ten albums in order, including a top-three display and complete ranked list.
- **Image export and sharing:** Save results as a PNG, copy the ranking as text, or use supported device and social-sharing features.
- **Saved progress:** Selected albums and ranking progress are stored in your browser so you can return to an unfinished session.

## How to Use

1. Open the [Album Sorter website](https://amylatifa.github.io/album-sorter/).
2. Enter an album title, artist name, or both in the search bar and select **Search**.
3. Choose an album from the results and add it to your list. Repeat until you have selected **10 albums**. If an album is missing, use **Add an album manually**.
4. Select **Start Ranking** once your list is complete.
5. For each comparison, click the album you prefer. You can use `1` for the left album, `2` for the right album, and `U` to undo your previous choice.
6. Continue choosing until your final ranking appears, ordered from your favorite album to your least favorite.
7. Select **Save Image**, **Share**, or **Copy List** to keep or send your results. Select **Start Over** to create another ranking.

## Design and Development Process

For the original site, I started with the HTML and CSS layout before implementing the JavaScript functions for album search, selection, comparison, and displaying results. One of the more challenging parts was correctly connecting the album data returned by iTunes to the sorting and results functions. After resolving that issue, I focused on improving the layout, button interactions, and form accessibility.

The React rebuild gave me an opportunity to rethink the experience while keeping the visual identity of the original project. I also replaced browser alerts and text-entry prompts with interactive album cards so users can make their choices directly on the page.

The new version uses a **binary-insertion ranking approach** instead of the original bubble sort. Each album is inserted into an ordered list based on the user's head-to-head preferences. This allows the application to build a complete ranking without presenting every possible album pairing. React state manages the selected albums and comparison process, while browser local storage preserves progress.

I also wanted to address a limitation of the first version: some albums were unavailable through iTunes. I added MusicBrainz as a second catalog source and combined the results behind a single search interface. The application normalizes album titles and artist names to reduce duplicate results. Cover Art Archive provides artwork for MusicBrainz releases when available, and a record-style placeholder appears when artwork cannot be loaded.

Finally, I replaced CSV export with options that are more useful for sharing music preferences. The finished ranking can be downloaded as a PNG poster, shared as an image through a compatible device's native share menu, or posted as text through sharing links for X, Bluesky, WhatsApp, and Reddit.

## Technologies Used

| Technology | Purpose |
| --- | --- |
| React | Interactive interface and application state |
| TypeScript | Typed data models and application logic |
| Vite | Local development and production builds |
| CSS | Responsive layout, styling, and record graphic |
| iTunes Search API | Album metadata and cover artwork |
| MusicBrainz API | Additional album metadata and search coverage |
| Cover Art Archive | Cover artwork for MusicBrainz releases |
| Cloudflare Worker | Server-side proxy for MusicBrainz requests |
| GitHub Pages | Hosting the static React frontend |

## Running the Project Locally

You will need Node.js and npm installed.

```bash
npm install
npm run dev
```

Open the local address printed by Vite to use the application.

To create a production build:

```bash
npm run build
```

To run the project's tests:

```bash
npm test
```

The production build creates the React site in `dist/` and generates a Cloudflare Worker at `dist/server/index.js` for deployments that support Workers. That generated file should not be edited directly; its source is `scripts/build-worker.mjs`.

### API and Hosting Note

The iTunes Search API is requested directly by the browser. MusicBrainz search uses a `/api/musicbrainz` proxy so the application can identify itself to MusicBrainz and regulate requests.

**GitHub Pages hosts only the static frontend**, so it does not run the generated Cloudflare Worker or provide the `/api/musicbrainz` endpoint. To enable MusicBrainz on the GitHub Pages version, the proxy must be deployed separately and the frontend must be configured to call its hosted address. Until then, iTunes search and manual album entry can still be used.

# References

- Pop Sorter on Tumblr
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [Cover Art Archive](https://coverartarchive.org/)

---

Created by **Amy Sarr** as a personal project combining programming and music.