/**
 * Fetches all items from the Aadam Jacobs Archive.org collection
 * and saves them to src/data/catalog.json.
 *
 * Run: node scripts/fetch-catalog.mjs
 * Or:  npm run update-catalog
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COLLECTION_ID = "aadamjacobs";
const BATCH_SIZE = 500;
const FIELDS = [
  "identifier", "title", "creator", "date", "year",
  "venue", "coverage", "description", "publicdate",
  "downloads", "mediatype", "subject",
].join(",");

async function fetchPage(page) {
  const params = new URLSearchParams({
    q: `collection:${COLLECTION_ID}`,
    fl: FIELDS,
    sort: "publicdate desc",
    rows: String(BATCH_SIZE),
    page: String(page),
    output: "json",
  });

  const url = `https://archive.org/advancedsearch.php?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  const data = await res.json();
  return {
    docs: data?.response?.docs ?? [],
    numFound: data?.response?.numFound ?? 0,
  };
}

async function fetchAll() {
  const all = [];
  let page = 1;
  let numFound = null;

  while (true) {
    process.stdout.write(`  Page ${page}… `);
    const { docs, numFound: total } = await fetchPage(page);

    if (numFound === null) {
      numFound = total;
      console.log(`(${numFound} total items found)`);
    }

    all.push(...docs);
    console.log(`  ${all.length} / ${numFound} fetched`);

    if (docs.length === 0 || all.length >= numFound) break;
    page++;

    // polite delay
    await new Promise((r) => setTimeout(r, 400));
  }

  return all;
}

console.log("Fetching Aadam Jacobs collection from Archive.org…\n");
const items = await fetchAll();

const output = {
  updatedAt: new Date().toISOString(),
  total: items.length,
  items,
};

const outDir = resolve(__dirname, "../src/data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "catalog.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

console.log(`\nDone. Saved ${items.length} items to src/data/catalog.json`);
