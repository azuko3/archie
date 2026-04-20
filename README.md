# Archie — Aadam Jacobs Archive Explorer

A browser for the [Aadam Jacobs Collection](https://archive.org/details/aadamjacobs) on Archive.org — a deep catalog of live recordings from Chicago venues. Built as a static single-page app: the catalog is bundled at build time, and per-recording playable files are fetched on demand from Archive.org.

**Live:** https://archie-xxx.vercel.app _(update after first deploy)_

---

## Tech stack

- **React 18 + TypeScript + Vite** — static SPA, no backend
- **Tailwind CSS + shadcn/ui** — styling and component primitives
- **Radix UI Popover** — filter comboboxes and sort selector
- **Archive.org APIs** — `advancedsearch.php` (catalog, build time) and `/metadata/{id}` (playable files, runtime)
- **Vercel** — hosting

---

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

---

## Updating the catalog

The catalog lives as a static file at `src/data/catalog.json` (~2,500 items). It's bundled at build time, so refreshing the data means: re-fetch → commit → push → Vercel redeploys.

```bash
npm run update-catalog                              # fetches all items from Archive.org → writes src/data/catalog.json
git add src/data/catalog.json
git commit -m "catalog: refresh $(date +%Y-%m-%d)"
git push                                            # Vercel auto-deploys
```

The fetch script (`scripts/fetch-catalog.mjs`) paginates through Archive.org's advanced search with a 400ms delay between batches. A full refresh takes ~5–10 seconds.

---

## Deployment

Connected to Vercel via the `azuko3/archie` GitHub repo. Every push to `main` triggers a production build. No manual deploy step needed.

### Manual deploy (if ever necessary)

```bash
npm i -g vercel          # once
vercel --prod
```

---

## Project layout

```
src/
├── App.tsx              # main component — catalog browser + album detail + player
├── components/ui/       # shadcn/ui primitives (Card, Button, Popover, etc.)
├── data/catalog.json    # static catalog (generated — do not edit by hand)
├── lib/utils.ts         # cn() helper
├── index.css            # Tailwind entry
└── main.tsx             # React root

scripts/
└── fetch-catalog.mjs    # Node ESM script — refreshes src/data/catalog.json

.claude/memory/          # project notes for future sessions
```

---

## Features

- **Faceted search** — full-text query + cascading Artist / Venue / Decade filters
- **Sort** — newest added, year, artist, title, downloads
- **Two catalog views** — cards or list
- **Album detail view** — tracks list as the centerpiece, with metadata, description, and cover
- **Sticky bottom player** — click any track to start; auto-advances to next; keeps playing while you browse
- **Deep links to Archive.org** — every recording has an "Open on Archive.org" button

---

## Notes for future work

- `.claude/memory/` contains notes from earlier debugging sessions — worth a glance before tackling related bugs.
- The fetch script pulls the full catalog every run. If it ever grows to 10k+ items, consider incremental fetching by `publicdate > lastUpdate`.
- Playable files are detected by extension (`.mp3`, `.ogg`, `.m4a`) or format string containing `mp3`/`ogg`. Recordings that are FLAC-only will show "No browser-playable files" — that's expected; a link to Archive.org is still provided.
