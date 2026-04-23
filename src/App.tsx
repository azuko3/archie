import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Calendar,
  MapPin,
  User,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ExternalLink,
  Loader2,
  Disc3,
  Library,
  ChevronDown,
  X,
  ArrowUpDown,
  ArrowLeft,
  Check,
  LayoutGrid,
  List as ListIcon,
  Plus,
  Share2,
  ListMusic,
  Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import catalogData from "@/data/catalog.json";

const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: "date-desc", label: "Newest added" },
  { value: "year-desc", label: "Newest year" },
  { value: "year-asc", label: "Oldest year" },
  { value: "artist", label: "Artist A–Z" },
  { value: "title", label: "Title A–Z" },
  { value: "downloads", label: "Most downloaded" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];
type ViewMode = "grid" | "list";

type ArchiveItem = {
  identifier: string;
  title?: string;
  creator?: string | string[];
  date?: string;
  year?: string | number;
  venue?: string;
  coverage?: string;
  description?: string | string[];
  publicdate?: string;
  downloads?: number;
  mediatype?: string;
  subject?: string | string[];
};

type MetadataFile = {
  name: string;
  source?: string;
  format?: string;
  title?: string;
  track?: string;
  length?: string;
};

type MetadataResponse = {
  files?: MetadataFile[];
};

function formatDate(dateValue?: string) {
  if (!dateValue) return "Unknown date";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return dateValue;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function extractYear(item: ArchiveItem) {
  if (item.year) return String(item.year);
  if (item.date && /^\d{4}/.test(item.date)) return item.date.slice(0, 4);
  return "Unknown";
}

function normalizeCreator(creator?: string | string[]) {
  if (!creator) return "Unknown artist";
  return Array.isArray(creator) ? creator.join(", ") : creator;
}

function normalizeDescription(description?: string | string[]) {
  if (!description) return "";
  return Array.isArray(description) ? description.join(" ") : description;
}

function normalizeSubjects(subject?: string | string[]) {
  if (!subject) return [];
  return Array.isArray(subject) ? subject : [subject];
}

function normalizeVenue(item: ArchiveItem) {
  return item.venue || item.coverage || "Unknown venue";
}

function yearToDecade(year: string) {
  if (!/^\d{4}$/.test(year)) return "Unknown";
  return `${year.slice(0, 3)}0s`;
}

function buildAudioUrl(identifier: string, fileName: string) {
  return `https://archive.org/download/${identifier}/${encodeURIComponent(fileName)}`;
}

function buildAlbumUrl(identifier: string) {
  return `https://archive.org/details/${identifier}`;
}

// ─── Favorites (localStorage) ─────────────────────────────────────────────────
const FAVORITES_KEY = "archie:favorites:v1";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs])); } catch { /* ignore */ }
}

function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const toggle = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  };
  const isFavorite = (id: string) => favorites.has(id);
  return { favorites, toggle, isFavorite };
}

// ─── Share ────────────────────────────────────────────────────────────────────
// Only pass { url } — sending title/text causes many messaging apps
// (WhatsApp, Slack, Telegram) to concatenate everything into the shared message.
async function shareLink(url: string): Promise<"shared" | "copied" | "error"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ url });
      return "shared";
    }
  } catch {
    // user cancelled or share failed — fall through to clipboard copy
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "error";
  }
}

// ─── Description parsing ──────────────────────────────────────────────────────
function decodeEntities(s: string) {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type DescBlock =
  | { kind: "intro"; text: string }
  | { kind: "credits"; entries: { label: string; value: string }[] }
  | { kind: "lineage"; label: string; chain: string[] }
  | { kind: "setlist"; items: { n?: string; text: string }[] }
  | { kind: "footer"; text: string };

const CREDIT_MARKERS = ["Recorded By", "Transferred By", "Mastered By", "Recorded by", "Transferred by", "Mastered by", "Transfer by", "Transfer", "Transferred", "Mastering"];
const LINEAGE_MARKERS = ["Source", "Transfer", "Lineage", "Mastering"];
const MARKER_RE = new RegExp(`\\s(?=(${[...CREDIT_MARKERS, ...LINEAGE_MARKERS, "Setlist", "Recording \\d"].join("|")})[: ])`, "g");

function parseDescription(raw: string): DescBlock[] {
  const text = decodeEntities(raw);
  if (!text) return [];

  // Split by known markers — each chunk starts with a marker (except the first)
  const parts = text.split(MARKER_RE).filter((p) => p && p.trim());

  const blocks: DescBlock[] = [];
  const creditEntries: { label: string; value: string }[] = [];

  parts.forEach((part, idx) => {
    const chunk = part.trim();

    // Setlist
    if (/^Setlist\s*[:\-]/i.test(chunk)) {
      const body = chunk.replace(/^Setlist\s*[:\-]\s*/i, "");
      const items = splitSetlist(body);
      blocks.push({ kind: "setlist", items });
      return;
    }

    // Lineage (Source / Transfer / Lineage / Mastering) — has `>` chain
    const lineageMatch = chunk.match(/^(Source|Transfer|Lineage|Mastering)\s*[:\-]\s*(.+)$/i);
    if (lineageMatch && lineageMatch[2].includes(">")) {
      blocks.push({
        kind: "lineage",
        label: lineageMatch[1],
        chain: lineageMatch[2].split(">").map((s) => s.trim()).filter(Boolean),
      });
      return;
    }

    // Credit line (Recorded By: X, Transferred By: Y)
    const creditMatch = chunk.match(/^(Recorded By|Transferred By|Mastered By|Recorded by|Transferred by|Mastered by|Transfer by)\s*[:\-]?\s*(.+)$/i);
    if (creditMatch) {
      creditEntries.push({ label: creditMatch[1], value: creditMatch[2].trim() });
      return;
    }

    // Recording / Collection footer
    if (/^Recording\s+\d/.test(chunk)) {
      blocks.push({ kind: "footer", text: chunk });
      return;
    }

    // Intro (first chunk)
    if (idx === 0) {
      blocks.push({ kind: "intro", text: chunk });
      return;
    }

    // Unknown → treat as footer text
    blocks.push({ kind: "footer", text: chunk });
  });

  if (creditEntries.length > 0) {
    // Insert credits block after intro (or at top)
    const introIdx = blocks.findIndex((b) => b.kind === "intro");
    const insertAt = introIdx >= 0 ? introIdx + 1 : 0;
    blocks.splice(insertAt, 0, { kind: "credits", entries: creditEntries });
  }

  return blocks;
}

function splitSetlist(body: string): { n?: string; text: string }[] {
  // Match numbered items like "01:", "1.", "01)", "1)"
  const items: { n?: string; text: string }[] = [];
  const re = /(\d{1,2})\s*[:.)]\s*/g;
  let match: RegExpExecArray | null;
  const positions: { n: string; idx: number }[] = [];
  while ((match = re.exec(body)) !== null) {
    positions.push({ n: match[1], idx: match.index + match[0].length });
  }
  if (positions.length === 0) {
    return body.split(/\s{2,}|,\s+/).filter(Boolean).map((t) => ({ text: t.trim() }));
  }
  positions.forEach((pos, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].idx - positions[i + 1].n.length - 2 : body.length;
    const text = body.slice(pos.idx, end).trim().replace(/[;,.]+$/, "");
    if (text) items.push({ n: pos.n, text });
  });
  return items;
}

function isPlayable(file: MetadataFile) {
  const name = file.name.toLowerCase();
  const format = (file.format || "").toLowerCase();
  return (
    name.endsWith(".mp3") ||
    name.endsWith(".ogg") ||
    name.endsWith(".m4a") ||
    format.includes("mp3") ||
    format.includes("ogg")
  );
}

function buildHaystack(item: ArchiveItem): string {
  return [
    item.title || "",
    normalizeCreator(item.creator),
    normalizeVenue(item),
    item.coverage || "",
    item.date || "",
    extractYear(item),
    normalizeDescription(item.description),
    normalizeSubjects(item.subject).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

type MatchField = "title" | "artist" | "venue" | "date" | "other" | null;

function getMatchField(item: ArchiveItem, q: string): MatchField {
  if (!q) return null;
  const ql = q.toLowerCase();
  if ((item.title || "").toLowerCase().includes(ql)) return "title";
  if (normalizeCreator(item.creator).toLowerCase().includes(ql)) return "artist";
  if (normalizeVenue(item).toLowerCase().includes(ql)) return "venue";
  if ((item.date || "").toLowerCase().includes(ql) || extractYear(item).includes(ql)) return "date";
  return "other";
}

// ─── Searchable Combobox ──────────────────────────────────────────────────────
function ComboboxFilter({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, search]);

  const isActive = value !== "all";
  const displayLabel = isActive ? value : label;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTimeout(() => inputRef.current?.focus(), 50);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
            isActive
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          }`}
        >
          {icon}
          <span className="max-w-[140px] truncate">{displayLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="border-b border-zinc-800 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}s…`}
              className="w-full rounded-lg bg-zinc-950 py-1.5 pl-7 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          <button
            onClick={() => { onChange("all"); setOpen(false); setSearch(""); }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-zinc-800 ${value === "all" ? "text-emerald-400" : "text-zinc-300"}`}
          >
            {value === "all" ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
            All {label.toLowerCase()}s
          </button>
          {filtered.slice(0, 80).map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); setSearch(""); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800 ${value === opt ? "text-emerald-400" : "text-zinc-300"}`}
            >
              {value === opt ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{opt}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-zinc-500">No results</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Sort selector ─────────────────────────────────────────────────────────────
function SortSelector({ value, onChange }: { value: SortValue; onChange: (v: SortValue) => void }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value)!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100">
          <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
          <span>{current.label}</span>
          <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52">
        <div className="py-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-zinc-800 ${value === opt.value ? "text-emerald-400" : "text-zinc-300"}`}
            >
              {value === opt.value ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── View mode toggle ─────────────────────────────────────────────────────────
function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex h-9 items-center rounded-full border border-zinc-700 bg-zinc-900 p-0.5">
      <button
        onClick={() => onChange("grid")}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${
          value === "grid" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
        }`}
        title="Grid view"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Cards
      </button>
      <button
        onClick={() => onChange("list")}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${
          value === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
        }`}
        title="List view"
      >
        <ListIcon className="h-3.5 w-3.5" />
        List
      </button>
    </div>
  );
}

// ─── Active filter chip ────────────────────────────────────────────────────────
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
      {label}
      <button onClick={onRemove} className="rounded-full hover:text-white">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
const allItems = catalogData.items as ArchiveItem[];

export default function AadamJacobsArchiveExplorer() {
  // Filters
  const [query, setQuery] = useState("");
  const [decade, setDecade] = useState("all");
  const [artist, setArtist] = useState("all");
  const [venue, setVenue] = useState("all");
  const [sortBy, setSortBy] = useState<SortValue>("date-desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [page, setPage] = useState(1);

  const { favorites, toggle: toggleFavorite, isFavorite } = useFavorites();

  // Navigation / album detail
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  const [files, setFiles] = useState<MetadataFile[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);

  // Player
  const [currentAlbum, setCurrentAlbum] = useState<ArchiveItem | null>(null);
  const [currentFiles, setCurrentFiles] = useState<MetadataFile[]>([]);
  const [currentTrackIdx, setCurrentTrackIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { setPage(1); }, [query, decade, artist, venue, sortBy, onlyFavorites]);

  // Load metadata for the selected album (detail view)
  useEffect(() => {
    let active = true;
    async function loadMetadata() {
      if (!selected?.identifier) { setFiles([]); return; }
      try {
        setMetaLoading(true);
        const res = await fetch(`https://archive.org/metadata/${selected.identifier}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: MetadataResponse = await res.json();
        if (!active) return;
        const playable = (data.files || []).filter(isPlayable);
        setFiles(playable);
      } catch {
        if (!active) return;
        setFiles([]);
      } finally {
        if (active) setMetaLoading(false);
      }
    }
    loadMetadata();
    return () => { active = false; };
  }, [selected]);

  // Cascading option lists
  const decades = useMemo(() => {
    const values = Array.from(new Set(allItems.map((item) => yearToDecade(extractYear(item))))).filter(Boolean);
    return values.sort();
  }, []);

  const decadeStats = useMemo(
    () => decades.map((d) => ({ label: d, count: allItems.filter((item) => yearToDecade(extractYear(item)) === d).length })),
    [decades]
  );

  const availableArtists = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = allItems.filter((item) => {
      const itemYear = extractYear(item);
      if (decade !== "all" && yearToDecade(itemYear) !== decade) return false;
      if (venue !== "all" && normalizeVenue(item) !== venue) return false;
      if (q && !buildHaystack(item).includes(q)) return false;
      return true;
    });
    return Array.from(new Set(candidates.map((item) => normalizeCreator(item.creator)))).sort((a, b) => a.localeCompare(b));
  }, [query, decade, venue]);

  const availableVenues = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = allItems.filter((item) => {
      const itemYear = extractYear(item);
      if (decade !== "all" && yearToDecade(itemYear) !== decade) return false;
      if (artist !== "all" && normalizeCreator(item.creator) !== artist) return false;
      if (q && !buildHaystack(item).includes(q)) return false;
      return true;
    });
    return Array.from(new Set(candidates.map(normalizeVenue))).sort((a, b) => a.localeCompare(b));
  }, [query, decade, artist]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = allItems.filter((item) => {
      const itemYear = extractYear(item);
      return (
        (!q || buildHaystack(item).includes(q)) &&
        (decade === "all" || yearToDecade(itemYear) === decade) &&
        (artist === "all" || normalizeCreator(item.creator) === artist) &&
        (venue === "all" || normalizeVenue(item) === venue) &&
        (!onlyFavorites || favorites.has(item.identifier))
      );
    });
    next.sort((a, b) => {
      if (sortBy === "downloads") return (b.downloads || 0) - (a.downloads || 0);
      if (sortBy === "artist") return normalizeCreator(a.creator).localeCompare(normalizeCreator(b.creator));
      if (sortBy === "title") return (a.title || a.identifier).localeCompare(b.title || b.identifier);
      if (sortBy === "year-asc") return extractYear(a).localeCompare(extractYear(b));
      if (sortBy === "year-desc") return extractYear(b).localeCompare(extractYear(a));
      return (b.publicdate || "").localeCompare(a.publicdate || "");
    });
    return next;
  }, [query, decade, artist, venue, sortBy, onlyFavorites, favorites]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedDescription = normalizeDescription(selected?.description);

  const quickStats = useMemo(() => ({
    uniqueArtists: new Set(allItems.map((item) => normalizeCreator(item.creator))).size,
    uniqueVenues: new Set(allItems.map(normalizeVenue)).size,
  }), []);

  function resetAll() {
    setQuery(""); setDecade("all"); setArtist("all"); setVenue("all"); setSortBy("date-desc");
  }

  // ── Player controls ──
  function playTrack(album: ArchiveItem, fileList: MetadataFile[], idx: number) {
    setCurrentAlbum(album);
    setCurrentFiles(fileList);
    setCurrentTrackIdx(idx);
    setIsPlaying(true);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) { audio.play(); setIsPlaying(true); }
    else { audio.pause(); setIsPlaying(false); }
  }

  function skipTrack(delta: number) {
    if (currentFiles.length === 0) return;
    const next = currentTrackIdx + delta;
    if (next < 0 || next >= currentFiles.length) return;
    setCurrentTrackIdx(next);
    setIsPlaying(true);
  }

  // Auto-load audio when track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentTrackIdx < 0 || !currentAlbum) return;
    const file = currentFiles[currentTrackIdx];
    if (!file) return;

    audio.src = buildAudioUrl(currentAlbum.identifier, file.name);
    audio.load(); // iOS range-request fix
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((err) => {
        console.warn("[player] play failed", err);
        setIsPlaying(false);
      });

    // Media session (OS-level media controls on iOS/Android/macOS)
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: file.title || file.name,
        artist: normalizeCreator(currentAlbum.creator),
        album: currentAlbum.title || currentAlbum.identifier,
      });
      navigator.mediaSession.setActionHandler("play", () => audio.play());
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => skipTrack(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => skipTrack(1));
    }
  }, [currentTrackIdx, currentAlbum, currentFiles]);

  const currentTrack = currentTrackIdx >= 0 ? currentFiles[currentTrackIdx] : null;
  const hasPlayer = !!currentTrack && !!currentAlbum;

  // Toast feedback (share copy, etc.)
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Render ──
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ paddingBottom: hasPlayer ? 96 : 0 }}>
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">

        {/* ── Header ── */}
        <div className="mb-4 rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-black p-4 shadow-2xl sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1 text-xs uppercase tracking-[0.25em] text-zinc-400">
                <Disc3 className="h-3.5 w-3.5" />
                Aadam Jacobs Collection Explorer
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Archie — a deep live archive</h1>
              <p className="text-xs text-zinc-600">
                Catalog last updated: {new Date(catalogData.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                {" · "}{catalogData.total.toLocaleString()} total items
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 xl:w-[360px] shrink-0">
              <StatCard label="Items" value={String(allItems.length)} icon={<Library className="h-4 w-4" />} />
              <StatCard label="Artists" value={String(quickStats.uniqueArtists)} icon={<User className="h-4 w-4" />} />
              <StatCard label="Venues" value={String(quickStats.uniqueVenues)} icon={<MapPin className="h-4 w-4" />} />
            </div>
          </div>

          {/* Filters are only relevant in browse mode */}
          {!selected && (
            <>
              {/* ── Search row ── */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1" style={{ minWidth: 200 }}>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search title, artist, venue, year…"
                    className="h-9 rounded-full border-zinc-700 bg-zinc-950 pl-10 pr-8 text-sm text-zinc-100 placeholder:text-zinc-500"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <ComboboxFilter label="Artist" value={artist} onChange={setArtist} options={availableArtists} icon={<User className="h-3.5 w-3.5" />} />
                <ComboboxFilter label="Venue" value={venue} onChange={setVenue} options={availableVenues} icon={<MapPin className="h-3.5 w-3.5" />} />
                <button
                  onClick={() => setOnlyFavorites((v) => !v)}
                  className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
                    onlyFavorites
                      ? "border-amber-400 bg-amber-400/15 text-amber-200"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                  }`}
                  title={onlyFavorites ? "Show all" : "Show only favorites"}
                >
                  <Star className={`h-3.5 w-3.5 ${onlyFavorites ? "fill-amber-300 text-amber-300" : ""}`} />
                  Favorites
                  {favorites.size > 0 && (
                    <span className="text-xs opacity-60">{favorites.size}</span>
                  )}
                </button>
                <SortSelector value={sortBy} onChange={setSortBy} />
                <ViewToggle value={viewMode} onChange={setViewMode} />

                {(artist !== "all" || venue !== "all" || query) && (
                  <button onClick={resetAll} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3.5 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200">
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                )}
              </div>

              {/* ── Decade chips ── */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setDecade("all")}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${decade === "all" ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"}`}
                >
                  All
                </button>
                {decadeStats.map(({ label, count }) => (
                  <button
                    key={label}
                    onClick={() => setDecade(label === decade ? "all" : label)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${decade === label ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"}`}
                  >
                    {label} <span className="opacity-60">{count}</span>
                  </button>
                ))}
              </div>

              {/* ── Active filter chips ── */}
              {(artist !== "all" || venue !== "all") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {artist !== "all" && <FilterChip label={artist} onRemove={() => setArtist("all")} />}
                  {venue !== "all" && <FilterChip label={venue} onRemove={() => setVenue("all")} />}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Body ── */}
        {selected ? (
          <AlbumDetail
            album={selected}
            files={files}
            metaLoading={metaLoading}
            description={selectedDescription}
            currentTrack={currentTrack}
            currentAlbumId={currentAlbum?.identifier}
            onBack={() => setSelected(null)}
            onPlayTrack={(idx) => playTrack(selected, files, idx)}
            onToast={setToast}
            isFavorite={isFavorite(selected.identifier)}
            onToggleFavorite={() => toggleFavorite(selected.identifier)}
          />
        ) : (
          <CatalogView
            query={query}
            artist={artist}
            venue={venue}
            decade={decade}
            viewMode={viewMode}
            pagedItems={pagedItems}
            filteredTotal={filteredItems.length}
            page={page}
            totalPages={totalPages}
            onSelect={setSelected}
            onResetAll={resetAll}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            onlyFavorites={onlyFavorites}
          />
        )}
      </div>

      {/* ── Sticky bottom player ── */}
      {hasPlayer && currentTrack && currentAlbum && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            {/* Now playing */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                onClick={() => setSelected(currentAlbum)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 transition-colors hover:bg-emerald-500/25"
                title="Open tracklist"
                aria-label="Open tracklist"
              >
                <ListMusic className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="line-clamp-1 text-sm text-zinc-100">{currentTrack.title || currentTrack.name}</div>
                <div className="line-clamp-1 text-xs text-zinc-500">
                  <button
                    onClick={() => setSelected(currentAlbum)}
                    className="hover:text-zinc-300 hover:underline underline-offset-2"
                  >
                    {normalizeCreator(currentAlbum.creator)} · {currentAlbum.title || currentAlbum.identifier}
                  </button>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => skipTrack(-1)}
                disabled={currentTrackIdx <= 0}
                className="rounded-full p-2 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                title="Previous track"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 transition-colors hover:bg-emerald-400"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
              </button>
              <button
                onClick={() => skipTrack(1)}
                disabled={currentTrackIdx >= currentFiles.length - 1}
                className="rounded-full p-2 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                title="Next track"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            {/* Native audio for scrub + volume */}
            <audio
              ref={audioRef}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => {
                if (currentTrackIdx < currentFiles.length - 1) skipTrack(1);
                else setIsPlaying(false);
              }}
              onError={(e) => {
                const el = e.currentTarget;
                console.warn("[player] audio error", {
                  code: el.error?.code,
                  message: el.error?.message,
                  src: el.currentSrc,
                  trackIdx: currentTrackIdx,
                });
                // Auto-skip broken tracks; stop if it's the last one
                if (currentTrackIdx < currentFiles.length - 1) {
                  setTimeout(() => skipTrack(1), 400);
                } else {
                  setIsPlaying(false);
                }
              }}
              onStalled={() => console.debug("[player] stalled", { trackIdx: currentTrackIdx })}
              controls
              className="hidden min-w-0 flex-1 sm:block"
              style={{ maxWidth: 360 }}
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur"
          style={{ bottom: hasPlayer ? 96 : 24 }}
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Catalog view (grid/list) ─────────────────────────────────────────────────
function CatalogView({
  query, artist, venue, decade, viewMode,
  pagedItems, filteredTotal, page, totalPages,
  onSelect, onResetAll, onPrev, onNext,
  isFavorite, onToggleFavorite, onlyFavorites,
}: {
  query: string;
  artist: string;
  venue: string;
  decade: string;
  viewMode: ViewMode;
  pagedItems: ArchiveItem[];
  filteredTotal: number;
  page: number;
  totalPages: number;
  onSelect: (item: ArchiveItem) => void;
  onResetAll: () => void;
  onPrev: () => void;
  onNext: () => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
  onlyFavorites: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-400">{filteredTotal.toLocaleString()} recordings</div>
        <Badge variant="secondary" className="rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 font-normal">
          {page} / {totalPages}
        </Badge>
      </div>

      {pagedItems.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="text-3xl">{onlyFavorites ? "⭐" : "🎵"}</div>
            <div>
              <div className="text-sm font-medium text-zinc-300">
                {onlyFavorites ? "No favorites yet" : "No recordings match these filters"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {onlyFavorites
                  ? "Click the star on any recording to save it here."
                  : <>Try removing one of the active filters, or <button onClick={onResetAll} className="text-emerald-400 underline-offset-2 hover:underline">clear all filters</button></>
                }
              </div>
            </div>
            {(artist !== "all" || venue !== "all" || decade !== "all" || query) && (
              <div className="flex flex-wrap justify-center gap-2 text-xs text-zinc-500">
                {query && <span className="rounded-full border border-zinc-700 px-2.5 py-1">search: "{query}"</span>}
                {artist !== "all" && <span className="rounded-full border border-zinc-700 px-2.5 py-1">artist: {artist}</span>}
                {venue !== "all" && <span className="rounded-full border border-zinc-700 px-2.5 py-1">venue: {venue}</span>}
                {decade !== "all" && <span className="rounded-full border border-zinc-700 px-2.5 py-1">decade: {decade}</span>}
              </div>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {pagedItems.map((item) => (
            <CatalogCard
              key={item.identifier}
              item={item}
              query={query}
              onClick={() => onSelect(item)}
              favorite={isFavorite(item.identifier)}
              onToggleFavorite={() => onToggleFavorite(item.identifier)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <div className="hidden items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 text-[11px] uppercase tracking-wider text-zinc-500 sm:flex">
            <div className="w-8 shrink-0"></div>
            <div className="w-12 shrink-0">Year</div>
            <div className="flex-1 min-w-0">Title</div>
            <div className="w-40 shrink-0">Artist</div>
            <div className="w-40 shrink-0">Venue</div>
            <div className="w-20 shrink-0 text-right">Date</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {pagedItems.map((item) => (
              <CatalogRow
                key={item.identifier}
                item={item}
                query={query}
                onClick={() => onSelect(item)}
                favorite={isFavorite(item.identifier)}
                onToggleFavorite={() => onToggleFavorite(item.identifier)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" className="rounded-full border-zinc-700 bg-zinc-900 h-9 px-5 text-sm" disabled={page <= 1} onClick={onPrev}>
          ← Prev
        </Button>
        <Button variant="outline" className="rounded-full border-zinc-700 bg-zinc-900 h-9 px-5 text-sm" disabled={page >= totalPages} onClick={onNext}>
          Next →
        </Button>
      </div>
    </div>
  );
}

function CatalogCard({
  item, query, onClick, favorite, onToggleFavorite,
}: {
  item: ArchiveItem;
  query: string;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const matchLabels: Record<NonNullable<MatchField>, string> = { title: "title", artist: "artist", venue: "venue", date: "date", other: "notes" };
  const f = query ? getMatchField(item, query.trim()) : null;
  return (
    <div className="relative">
      <button onClick={onClick} className="block w-full text-left transition-transform hover:-translate-y-0.5">
        <Card className="h-full rounded-3xl border border-zinc-800 bg-zinc-900/80 transition-colors hover:border-zinc-700">
          <CardHeader className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <Badge variant="secondary" className="rounded-full border border-zinc-700 bg-zinc-950 text-zinc-300 font-normal">
                {extractYear(item)}
              </Badge>
              <div className="flex items-center gap-2 pr-7">
                {f && (
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">{matchLabels[f]}</span>
                )}
                {typeof item.downloads === "number" && (
                  <span className="text-xs text-zinc-500">{item.downloads.toLocaleString()} ↓</span>
                )}
              </div>
            </div>
            <CardTitle className="line-clamp-2 text-sm leading-5 text-zinc-50">{item.title || item.identifier}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4 pt-0 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0" /><span className="line-clamp-1">{normalizeCreator(item.creator)}</span></div>
            <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 shrink-0" /><span>{formatDate(item.date || item.publicdate)}</span></div>
            <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="line-clamp-1">{normalizeVenue(item)}</span></div>
          </CardContent>
        </Card>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`absolute right-3 top-3 rounded-full p-1.5 transition-colors ${
          favorite
            ? "text-amber-300 hover:bg-amber-400/10"
            : "text-zinc-600 hover:bg-zinc-800 hover:text-amber-300"
        }`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorite}
      >
        <Star className={`h-4 w-4 ${favorite ? "fill-amber-300" : ""}`} />
      </button>
    </div>
  );
}

function CatalogRow({
  item, query, onClick, favorite, onToggleFavorite,
}: {
  item: ArchiveItem;
  query: string;
  onClick: () => void;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const matchLabels: Record<NonNullable<MatchField>, string> = { title: "title", artist: "artist", venue: "venue", date: "date", other: "notes" };
  const f = query ? getMatchField(item, query.trim()) : null;
  return (
    <div className="group flex w-full items-center gap-3 bg-zinc-900/40 px-4 py-2.5 text-sm transition-colors hover:bg-zinc-800/60">
      <button
        onClick={onToggleFavorite}
        className={`w-8 shrink-0 rounded-full p-1 transition-colors ${
          favorite ? "text-amber-300" : "text-zinc-600 hover:text-amber-300"
        }`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorite}
      >
        <Star className={`h-4 w-4 ${favorite ? "fill-amber-300" : ""}`} />
      </button>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="w-12 shrink-0 text-xs text-zinc-500">{extractYear(item)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="line-clamp-1 text-zinc-100">{item.title || item.identifier}</div>
            {f && (
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">{matchLabels[f]}</span>
            )}
          </div>
        </div>
        <div className="w-40 shrink-0 truncate text-xs text-zinc-400">{normalizeCreator(item.creator)}</div>
        <div className="w-40 shrink-0 truncate text-xs text-zinc-500">{normalizeVenue(item)}</div>
        <div className="w-20 shrink-0 text-right text-xs text-zinc-500">{formatDate(item.date || item.publicdate)}</div>
      </button>
    </div>
  );
}

// ─── Album detail view ────────────────────────────────────────────────────────
function AlbumDetail({
  album,
  files,
  metaLoading,
  description,
  currentTrack,
  currentAlbumId,
  onBack,
  onPlayTrack,
  onToast,
  isFavorite,
  onToggleFavorite,
}: {
  album: ArchiveItem;
  files: MetadataFile[];
  metaLoading: boolean;
  description: string;
  currentTrack: MetadataFile | null;
  currentAlbumId?: string;
  onBack: () => void;
  onPlayTrack: (idx: number) => void;
  onToast: (msg: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  async function handleShareAlbum() {
    const result = await shareLink(buildAlbumUrl(album.identifier));
    if (result === "copied") onToast("Link copied");
    else if (result === "error") onToast("Couldn't share");
  }

  async function handleShareTrack(file: MetadataFile) {
    const result = await shareLink(buildAudioUrl(album.identifier, file.name));
    if (result === "copied") onToast("Track link copied");
    else if (result === "error") onToast("Couldn't share");
  }
  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </button>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left: cover + metadata */}
        <div className="space-y-4">
          <div className="flex aspect-square items-center justify-center rounded-3xl border border-zinc-800 bg-gradient-to-br from-emerald-500/15 via-zinc-900 to-black">
            <Disc3 className="h-24 w-24 text-emerald-400/80" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Live recording</div>
              <button
                onClick={onToggleFavorite}
                className={`rounded-full p-1.5 transition-colors ${
                  isFavorite ? "text-amber-300 hover:bg-amber-400/10" : "text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
                }`}
                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={isFavorite}
              >
                <Star className={`h-4 w-4 ${isFavorite ? "fill-amber-300" : ""}`} />
              </button>
            </div>
            <h2 className="text-2xl font-semibold leading-tight text-zinc-50">{album.title || album.identifier}</h2>
            <div className="text-sm text-zinc-300">{normalizeCreator(album.creator)}</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <InfoBox label="Date" value={formatDate(album.date || album.publicdate)} />
            <InfoBox label="Year" value={extractYear(album)} />
            <InfoBox label="Venue" value={normalizeVenue(album)} className="col-span-2" />
          </div>

          {description && <DescriptionCard description={description} />}

          <div className="flex gap-2">
            <a href={`https://archive.org/details/${album.identifier}`} target="_blank" rel="noreferrer" className="flex-1">
              <Button className="w-full rounded-2xl bg-emerald-600 text-white hover:bg-emerald-500 h-10 text-sm">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open on Archive.org
              </Button>
            </a>
            <Button
              onClick={handleShareAlbum}
              variant="outline"
              className="h-10 w-10 shrink-0 rounded-2xl border-zinc-700 bg-zinc-900 p-0 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
              title="Share album"
              aria-label="Share album"
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Right: tracks list — center stage */}
        <Card className="rounded-3xl border-zinc-800 bg-zinc-900/50">
          <CardHeader className="border-b border-zinc-800 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg text-zinc-50">Tracks</CardTitle>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {metaLoading ? "Loading…" : files.length > 0 ? `${files.length} playable tracks` : "No playable files"}
                </div>
              </div>
              {files.length > 0 && (
                <Button
                  onClick={() => onPlayTrack(0)}
                  className="rounded-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 h-9 px-4 text-sm"
                >
                  <Play className="mr-1.5 h-4 w-4 translate-x-[1px]" /> Play all
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-2">
            {metaLoading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading tracks…
              </div>
            ) : files.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500">
                No browser-playable files (MP3/OGG) for this recording.
                <div className="mt-1 text-xs text-zinc-600">Check Archive.org — it may be available as FLAC or another format.</div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {files.map((file, idx) => {
                  const isCurrent = currentAlbumId === album.identifier && currentTrack?.name === file.name;
                  return (
                    <div
                      key={`${file.name}-${idx}`}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-zinc-800/50 ${
                        isCurrent ? "bg-emerald-500/10" : ""
                      }`}
                    >
                      <div className="w-6 shrink-0 text-right text-xs tabular-nums text-zinc-600">{String(idx + 1).padStart(2, "0")}</div>
                      <button
                        onClick={() => onPlayTrack(idx)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          isCurrent
                            ? "bg-emerald-500 text-zinc-950"
                            : "bg-zinc-800 text-zinc-400 group-hover:bg-emerald-500/20 group-hover:text-emerald-300"
                        }`}>
                          <Play className="h-3.5 w-3.5 translate-x-[1px]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`line-clamp-1 text-sm ${isCurrent ? "text-emerald-300" : "text-zinc-100"}`}>
                            {file.title || file.name}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                            {file.format || "Unknown format"}{file.track ? ` · Track ${file.track}` : ""}
                            {file.length ? ` · ${file.length}` : ""}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShareTrack(file); }}
                        className="shrink-0 rounded-full p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100 focus:opacity-100"
                        title="Share track"
                        aria-label="Share track"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Description card (preview + expand) ─────────────────────────────────────
function DescriptionCard({ description }: { description: string }) {
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => {
    const decoded = decodeEntities(description);
    return decoded.length > 220 ? decoded.slice(0, 220).trimEnd() + "…" : decoded;
  }, [description]);

  return (
    <>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Description</div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 text-zinc-400 transition-colors hover:border-emerald-500 hover:text-emerald-400"
            title="Expand description"
            aria-label="Expand description"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs leading-6 text-zinc-300">{preview}</p>
      </div>
      {open && <DescriptionModal description={description} onClose={() => setOpen(false)} />}
    </>
  );
}

function DescriptionModal({ description, onClose }: { description: string; onClose: () => void }) {
  const blocks = useMemo(() => parseDescription(description), [description]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="text-sm font-medium text-zinc-100">Description</div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(85vh-57px)] space-y-4 overflow-y-auto px-5 py-5 text-sm text-zinc-200">
          {blocks.map((block, i) => (
            <DescBlockView key={i} block={block} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DescBlockView({ block }: { block: DescBlock }) {
  if (block.kind === "intro") {
    return <p className="text-base leading-7 text-zinc-100">{block.text}</p>;
  }
  if (block.kind === "credits") {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Credits</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {block.entries.map((e, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs">
              <span className="w-28 shrink-0 text-zinc-500">{e.label}</span>
              <span className="text-zinc-200">{e.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (block.kind === "lineage") {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">{block.label}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {block.chain.map((step, i) => (
            <React.Fragment key={i}>
              <span className="rounded-md border border-zinc-700 bg-zinc-950/80 px-2 py-1 text-zinc-200">{step}</span>
              {i < block.chain.length - 1 && <span className="text-emerald-500">→</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }
  if (block.kind === "setlist") {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          <span>Setlist</span>
          <span className="text-zinc-600">· {block.items.length} songs</span>
        </div>
        <ol className="space-y-1 text-sm">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-baseline gap-3">
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-zinc-500">{item.n || String(i + 1).padStart(2, "0")}</span>
              <span className="text-zinc-100">{item.text}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  // footer
  return <p className="text-xs leading-6 text-zinc-500">{block.text}</p>;
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/80">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-zinc-500">{icon}<span>{label}</span></div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function InfoBox({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 ${className}`}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
