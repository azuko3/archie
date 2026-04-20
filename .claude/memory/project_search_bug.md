---
name: Search bug - title field missing from search
description: Archive.org search for "Nirvana" returns 4 results but our app shows only 1
type: project
---

Archive.org search for "Nirvana" returns 4 results; our app shows only 1.

**Root cause hypothesis:** The `creator` field in catalog.json may not always contain the artist name — sometimes the artist name appears only in the `title` field (e.g. "Nirvana Live at Dreamerz 1989-07-08"). Our search already includes `item.title` in the haystack, but the issue may be that the catalog fetch is missing items or the title isn't always populated correctly.

**Action needed:** Verify the 4 Archive.org results exist in catalog.json with their identifiers. Check if `creator` is missing on some of them and the artist name only appears in `title`. Ensure the search haystack correctly hits those items.

**Why:** User noticed discrepancy between Archive.org search (4 Nirvana results) and our app (1 result). Trust the Archive.org count as ground truth.

**How to apply:** Next session — debug by filtering catalog.json for "nirvana" across title, creator, description fields. May need to also index `subject` tags more aggressively or check if some items were dropped during the paginated fetch.
