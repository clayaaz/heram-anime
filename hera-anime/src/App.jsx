import { useState, useEffect, useCallback } from "react";

const ANILIST_URL = "/api/anilist";
const TMDB_KEY = "84f78b5761422e64caf879f69c8b8e33";
const TMDB_BASE = "https://api.themoviedb.org/3";
const VIDSRC = "https://vidsrc-embed.ru/embed/tv";

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
  "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"
];

const SORT_OPTIONS = [
  { value: "popularity_desc", label: "Most Popular", sort: ["POPULARITY_DESC"] },
  { value: "start_date_desc", label: "Newest First", sort: ["START_DATE_DESC"] },
  { value: "start_date_asc", label: "Oldest First", sort: ["START_DATE"] },
  { value: "score_desc", label: "Top Rated", sort: ["SCORE_DESC"] },
  { value: "favorites_desc", label: "Most Favourited", sort: ["FAVOURITES_DESC"] },
];

const MEDIA_LIST_FIELDS = `
  id
  idMal
  title { romaji english native }
  coverImage { large medium }
  averageScore
  startDate { year }
  episodes
`;

const ANIME_LIST_QUERY = `
  query ($page: Int, $perPage: Int, $sort: [MediaSort], $genre_in: [String], $search: String) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { lastPage }
      media(type: ANIME, sort: $sort, genre_in: $genre_in, search: $search, isAdult: false) {
        ${MEDIA_LIST_FIELDS}
      }
    }
  }
`;

const ANIME_DETAIL_QUERY = `
  query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id
      idMal
      title { romaji english native }
      coverImage { large medium }
      averageScore
      startDate { year }
      episodes
      description(asHtml: false)
      format
      genres
    }
  }
`;

function proxiedCover(url) {
  if (!url) return "";
  if (url.startsWith("/api/cover")) return url;
  if (/^https:\/\/s\d+\.anilist\.co\//i.test(url)) {
    return `/api/cover?u=${encodeURIComponent(url)}`;
  }
  return url;
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem("anime_history") || "[]"); }
  catch { return []; }
}
function saveHistory(item, tmdbId, season, ep) {
  const h = getHistory().filter(x => !(x.id === item.id && x.season === season && x.episode === ep));
  h.unshift({
    id: item.id,
    malId: item.mal_id,
    tmdbId: tmdbId,
    name: item.title,
    poster: item.images?.jpg?.image_url || "",
    season: season,
    episode: ep,
    watchedAt: Date.now()
  });
  localStorage.setItem("anime_history", JSON.stringify(h.slice(0, 100)));
}
function clearHistory() { localStorage.removeItem("anime_history"); }

async function anilistQuery(query, variables = {}) {
  const r = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

function normalizeMedia(media) {
  if (!media) return null;
  return {
    id: media.id,
    mal_id: media.idMal ?? media.id,
    title: media.title?.english || media.title?.romaji || "Unknown",
    title_japanese: media.title?.native,
    images: { jpg: { image_url: proxiedCover(media.coverImage?.large || media.coverImage?.medium || "") } },
    score: media.averageScore ? media.averageScore / 10 : 0,
    year: media.startDate?.year,
    aired: media.startDate?.year ? { prop: { from: { year: media.startDate.year } } } : undefined,
    episodesCount: media.episodes,
  };
}

function normalizeDetails(media) {
  if (!media) return null;
  return {
    synopsis: media.description,
    episodes: media.episodes,
    type: media.format,
    genres: (media.genres || []).map(g => ({ mal_id: g, name: g })),
  };
}

function generateEpisodes(count) {
  if (!count || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => ({
    mal_id: i + 1,
    title: `Episode ${i + 1}`,
  }));
}

async function fetchAnime(page = 1, genre = "", sortObj, search = "") {
  const variables = {
    page,
    perPage: 20,
    sort: search.trim() ? ["SEARCH_MATCH"] : sortObj.sort,
    genre_in: genre ? [genre] : undefined,
    search: search.trim() || undefined,
  };

  const data = await anilistQuery(ANIME_LIST_QUERY, variables);
  const pageData = data.Page;

  return {
    data: (pageData?.media || []).map(normalizeMedia),
    pagination: { last_visible_page: pageData?.pageInfo?.lastPage || 1 },
  };
}

async function fetchDetails({ id, malId } = {}) {
  let media = null;
  if (id) {
    const data = await anilistQuery(ANIME_DETAIL_QUERY, { id });
    media = data.Media;
  }
  if (!media && (malId || id)) {
    const data = await anilistQuery(ANIME_DETAIL_QUERY, { idMal: malId || id });
    media = data.Media;
  }
  return { data: normalizeDetails(media), media: normalizeMedia(media) };
}

async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", TMDB_KEY);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  return r.json();
}

// Search TMDB for video player ID with fallback to base title
async function fetchTmdbMapping(title, seasonNumber = 1) {
  // First: try exact title match
  let data = await tmdb("/search/tv", { query: title });
  if (data.results && data.results.length > 0) {
    return { id: data.results[0].id, found: true, season: seasonNumber };
  }
  
  // Fallback: strip season indicators and search base title
  // Handles "Season 2", "2nd Season", "Part 2", etc.
  const baseTitle = title
    .replace(/\s+(?:season|part| cour)\s*\d+/i, '')     // "Season 2", "Part 2", "Cour 2"
    .replace(/\s+\d+(?:st|nd|rd|th)\s+season/i, '')     // "2nd Season", "3rd Season"
    .replace(/\s+S\d+$/i, '')                            // "S2" at end
    .replace(/\s+II+$/i, '')                             // "II", "III" at end
    .replace(/\s+2$/i, '')                               // "2" at end
    .trim();
  
  if (baseTitle && baseTitle !== title) {
    data = await tmdb("/search/tv", { query: baseTitle });
    if (data.results && data.results.length > 0) {
      return { id: data.results[0].id, found: true, season: seasonNumber };
    }
  }
  
  return { id: null, found: false, season: seasonNumber };
}

function stripHtml(html) {
  return html ? html.replace(/<[^>]*>?/gm, '') : "";
}

// Detect season number from anime title
function detectSeason(title) {
  const patterns = [
    { regex: /season\s*(\d+)/i, group: 1 },
    { regex: /(\d+)(?:st|nd|rd|th)\s+season/i, group: 1 },
    { regex: /part\s*(\d+)/i, group: 1 },
    { regex: /cour\s*(\d+)/i, group: 1 },
    { regex: /\sS(\d+)$/i, group: 1 },
    { regex: /\s(II+)$/i, group: 1, roman: true },
    { regex: /\s(\d+)$/i, group: 1 },
  ];
  
  for (const p of patterns) {
    const match = title.match(p.regex);
    if (match) {
      if (p.roman) {
        // Convert Roman numerals
        const roman = match[p.group];
        if (roman === 'II') return 2;
        if (roman === 'III') return 3;
        if (roman === 'IV') return 4;
        if (roman === 'V') return 5;
        continue;
      }
      return parseInt(match[p.group], 10);
    }
  }
  
  return 1; // Default to season 1
}

export default function App() {
  const [view, setView] = useState("home");
  const [anime, setAnime] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedGenre, setSelectedGenre] = useState("");
  const [sortOption, setSortOption] = useState(SORT_OPTIONS[0]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [tmdbId, setTmdbId] = useState(null);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [watching, setWatching] = useState(false);
  const [history, setHistory] = useState(getHistory());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadAnime = useCallback(async () => {
    setLoading(true);
    const data = await fetchAnime(page, selectedGenre, sortOption, debouncedSearch);
    setAnime(data.data || []);
    setTotalPages(data.pagination?.last_visible_page || 1);
    setLoading(false);
  }, [page, selectedGenre, sortOption, debouncedSearch]);

  useEffect(() => { loadAnime(); }, [loadAnime]);

  useEffect(() => {
    if (!selected) return;
    setDetails(null);
    setEpisodes([]);
    setEpisodesLoading(true);
    setTmdbId(null);
    setTmdbLoading(true);
    setEpisode(1);
    setWatching(false);
    
    // Detect season from title
    const detectedSeason = detectSeason(selected.title);
    setSeason(detectedSeason);
    
    // Fetch anime details from AniList
    fetchDetails({ id: selected.id, malId: selected.mal_id }).then(result => {
      setDetails(result.data);
      setEpisodes(generateEpisodes(result.data?.episodes));
      setEpisodesLoading(false);
    });
    
    // Fetch TMDB ID with season-aware fallback
    fetchTmdbMapping(selected.title, detectedSeason).then(data => {
      setTmdbId(data.id);
      setTmdbLoading(false);
    });
  }, [selected]);

  const openAnime = (a) => { setSelected(a); setView("detail"); setEpisode(1); };
  
  const startWatching = (s, e) => { 
    setSeason(s);
    setEpisode(e); 
    setWatching(true); 
    saveHistory(selected, tmdbId, s, e); 
    setHistory(getHistory()); 
  };
  
  const changeGenre = (g) => { setSelectedGenre(g); setPage(1); };
  const changeSort = (val) => { 
    const opt = SORT_OPTIONS.find(o => o.value === val); 
    setSortOption(opt || SORT_OPTIONS[0]); 
    setPage(1); 
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e6f0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #7c3aed; border-radius: 3px; }
        .card { background: #13111c; border: 1px solid #2a2540; border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform .2s, border-color .2s; }
        .card:hover { transform: translateY(-4px); border-color: #7c3aed; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
        .tag { background: #1e1a2e; border: 1px solid #3d3660; border-radius: 20px; padding: 4px 12px; font-size: 12px; color: #a99fcf; cursor: pointer; transition: all .15s; white-space: nowrap; }
        .tag:hover, .tag.active { background: #7c3aed; border-color: #7c3aed; color: #fff; }
        .btn { background: #7c3aed; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; cursor: pointer; font-size: 14px; font-weight: 600; transition: background .15s; }
        .btn:hover { background: #6d28d9; }
        .btn:disabled { background: #3d3660; cursor: not-allowed; opacity: 0.6; }
        .btn-ghost { background: transparent; color: #a99fcf; border: 1px solid #3d3660; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; transition: all .15s; }
        .btn-ghost:hover { border-color: #7c3aed; color: #c4b8f0; }
        .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        input[type=text], select { background: #13111c; border: 1px solid #2a2540; border-radius: 8px; color: #e8e6f0; padding: 10px 14px; font-size: 14px; outline: none; transition: border-color .15s; }
        input[type=text]:focus, select:focus { border-color: #7c3aed; }
        select option { background: #13111c; }
        .ep-btn { background: #1e1a2e; border: 1px solid #2a2540; border-radius: 6px; padding: 6px 12px; color: #a99fcf; cursor: pointer; font-size: 13px; transition: all .15s; min-width: 36px; text-align: center; }
        .ep-btn:hover { background: #7c3aed; color: #fff; border-color: #7c3aed; }
        .ep-btn.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
        .nav-link { color: #a99fcf; cursor: pointer; font-size: 14px; font-weight: 500; padding: 6px 12px; border-radius: 6px; transition: all .15s; background: none; border: none; }
        .nav-link:hover { color: #fff; background: #1e1a2e; }
        .nav-link.active { color: #c4b8f0; background: #1e1a2e; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { width: 32px; height: 32px; border: 3px solid #2a2540; border-top-color: #7c3aed; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 40px auto; }
        .hist-card { display: flex; gap: 12px; align-items: center; background: #13111c; border: 1px solid #2a2540; border-radius: 10px; padding: 12px; cursor: pointer; transition: border-color .15s; }
        .hist-card:hover { border-color: #7c3aed; }
        .badge { background: #2a2140; color: #9b84e8; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
        .warn-box { background: #2a2540; border: 1px solid #4b4270; color: #a99fcf; padding: 12px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .success-badge { background: #1e3a2e; color: #4ade80; }
      `}</style>

      {/* Nav */}
      <nav style={{ background: "#0d0b14", borderBottom: "1px solid #1e1a2e", padding: "0 24px", display: "flex", alignItems: "center", gap: 8, height: 58, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: "#a78bfa", marginRight: 16, letterSpacing: -0.5 }}>🌸 HeramAnime</span>
        <button className={`nav-link ${view === "home" ? "active" : ""}`} onClick={() => { setView("home"); setSearch(""); }}>Browse</button>
        <button className={`nav-link ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>History</button>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <input type="text" placeholder="Search anime…" value={search} onChange={e => { setSearch(e.target.value); if (view !== "home") setView("home"); }} style={{ width: 220, paddingLeft: 36 }} />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#6b5fa0" }}>🔍</span>
        </div>
      </nav>

      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px" }}>

        {/* HOME VIEW */}
        {view === "home" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
                <select value={sortOption.value} onChange={e => changeSort(e.target.value)} style={{ minWidth: 170 }}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={{ color: "#4b4270", fontSize: 13 }}>Filter by genre:</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={`tag ${selectedGenre === "" ? "active" : ""}`} onClick={() => changeGenre("")}>All</button>
                {GENRES.map(g => (
                  <button key={g} className={`tag ${selectedGenre === g ? "active" : ""}`} onClick={() => changeGenre(g)}>{g}</button>
                ))}
              </div>
            </div>

            {debouncedSearch && !loading && (
              <p style={{ color: "#6b5fa0", fontSize: 13, marginBottom: 16 }}>
                {anime.length} results for "{debouncedSearch}"
              </p>
            )}

            {loading ? <div className="spinner" /> : (
              <>
                <div className="grid">
                  {anime.map(a => (
                    <div key={a.id} className="card" onClick={() => openAnime(a)}>
                      {a.images?.jpg?.image_url
                        ? <img src={a.images.jpg.image_url} alt={a.title} referrerPolicy="no-referrer" style={{ width: "100%", aspectRatio: "2/3", objectFit: "cover", display: "block" }} loading="lazy" />
                        : <div style={{ aspectRatio: "2/3", background: "#1e1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🌸</div>}
                      <div style={{ padding: "10px 10px 12px" }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#e0daf5", lineHeight: 1.3, marginBottom: 4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.title}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#6b5fa0" }}>{a.year || a.aired?.prop?.from?.year || "—"}</span>
                          {a.score > 0 && <span style={{ fontSize: 11, color: "#f59e0b" }}>★ {a.score.toFixed(1)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 32, alignItems: "center" }}>
                  <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ color: "#6b5fa0", fontSize: 13 }}>Page {page} / {totalPages}</span>
                  <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* DETAIL / WATCH VIEW */}
        {view === "detail" && selected && (
          <div>
            <button className="btn-ghost" style={{ marginBottom: 20 }} onClick={() => { setView("home"); setWatching(false); setSelected(null); }}>← Back to Browse</button>

            {episodesLoading || tmdbLoading ? <div className="spinner" /> : watching ? (
              <div>
                {tmdbId ? (
                  <div style={{ background: "#000", borderRadius: 10, overflow: "hidden", marginBottom: 20, aspectRatio: "16/9" }}>
                    <iframe
                      src={`${VIDSRC}/${tmdbId}/${season}-${episode}`}
                      style={{ width: "100%", height: "100%", border: "none" }}
                      allowFullScreen
                      referrerPolicy="origin"
                      title={`${selected.title} S${season}E${episode}`}
                    />
                  </div>
                ) : (
                  <div className="warn-box" style={{ aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 48 }}>📺</div>
                    <p>Video player unavailable — no TMDB match found for this anime.</p>
                  </div>
                )}
                <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: 18, color: "#e0daf5" }}>{selected.title}</h2>
                  <span className="badge">S{season} E{episode}</span>
                  {episode > 1 && <button className="btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => startWatching(season, episode - 1)}>← Prev Ep</button>}
                  {episode < episodes.length && <button className="btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => startWatching(season, episode + 1)}>Next Ep →</button>}
                </div>
                <EpisodeNav episodes={episodes} episode={episode} startWatching={(ep) => startWatching(season, ep)} />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 32 }}>
                <div>
                  {selected.images?.jpg?.image_url
                    ? <img src={proxiedCover(selected.images.jpg.image_url)} alt={selected.title} referrerPolicy="no-referrer" style={{ width: "100%", borderRadius: 10 }} />
                    : <div style={{ aspectRatio: "2/3", background: "#1e1a2e", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>🌸</div>}
                </div>
                <div>
                  <h1 style={{ fontSize: 26, fontWeight: 700, color: "#ede9fe", marginBottom: 8 }}>{selected.title}</h1>
                  {selected.title_japanese && <p style={{ color: "#6b5fa0", fontSize: 14, marginBottom: 12 }}>{selected.title_japanese}</p>}
                  <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                    {(selected.year || selected.aired?.prop?.from?.year) && <span className="badge">{selected.year || selected.aired.prop.from.year}</span>}
                    {selected.score > 0 && <span className="badge" style={{ color: "#f59e0b" }}>★ {selected.score.toFixed(1)}</span>}
                    {episodes.length > 0 && <span className="badge">{episodes.length} Episodes</span>}
                    {details?.episodes && details.episodes !== episodes.length && <span className="badge">{details.episodes} Listed</span>}
                    {details?.type && <span className="badge">{details.type}</span>}
                    {season > 1 && <span className="badge" style={{ color: "#a78bfa" }}>Season {season}</span>}
                    {tmdbId && <span className="badge success-badge">▶ Available</span>}
                    {!tmdbId && !tmdbLoading && <span className="badge" style={{ color: "#e05252" }}>▶ Unavailable</span>}
                  </div>
                  <p style={{ color: "#8b7eb8", fontSize: 14, lineHeight: 1.7, marginBottom: 24, maxWidth: 600 }}>
                    {details ? stripHtml(details.synopsis || "No description available.") : "Loading description..."}
                  </p>
                  {details?.genres && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                    {details.genres.map(g => <span key={g.mal_id} className="tag" style={{ cursor: "default" }}>{g.name}</span>)}
                  </div>}
                  
                  {episodes.length === 0 ? (
                    <div className="warn-box" style={{ marginBottom: 16 }}>
                      ⚠️ No episode data available from AniList for this anime.
                    </div>
                  ) : (
                    <button className="btn" style={{ fontSize: 15, padding: "12px 28px" }} onClick={() => startWatching(season, 1)} disabled={!tmdbId}>
                      ▶ Watch Episode 1
                    </button>
                  )}
                  {!tmdbId && !tmdbLoading && (
                    <p style={{ color: "#6b5fa0", fontSize: 12, marginTop: 8 }}>
                      TMDB ID not found — video playback unavailable for this title.
                    </p>
                  )}
                </div>
              </div>
            )}

            {!watching && episodes.length > 0 && <div style={{ marginTop: 32 }}>
              <EpisodeNav episodes={episodes} episode={episode} startWatching={(ep) => startWatching(season, ep)} />
            </div>}
          </div>
        )}

        {/* HISTORY VIEW */}
        {view === "history" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, color: "#ede9fe", fontWeight: 600 }}>Watch History</h2>
              {history.length > 0 && <button className="btn-ghost" style={{ color: "#e05252", borderColor: "#5a2020" }} onClick={() => { clearHistory(); setHistory([]); }}>Clear All</button>}
            </div>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", color: "#4b4270", padding: "60px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📺</div>
                <p>No watch history yet. Start watching some anime!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {history.map((h, i) => (
                  <div key={i} className="hist-card" onClick={() => { 
                    setSelected({ id: h.id, mal_id: h.malId || h.id, title: h.name, images: { jpg: { image_url: h.poster } } }); 
                    setTmdbId(h.tmdbId);
                    setSeason(h.season); 
                    setEpisode(h.episode); 
                    setView("detail"); 
                    setWatching(true); 
                  }}>
                    {h.poster
                      ? <img src={proxiedCover(h.poster)} alt={h.name} referrerPolicy="no-referrer" style={{ width: 52, height: 74, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                      : <div style={{ width: 52, height: 74, background: "#1e1a2e", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🌸</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, color: "#e0daf5", fontSize: 15, marginBottom: 4 }}>{h.name}</p>
                      <p style={{ color: "#6b5fa0", fontSize: 13 }}>S{h.season} · E{h.episode}</p>
                      <p style={{ color: "#3d3660", fontSize: 11, marginTop: 4 }}>{new Date(h.watchedAt).toLocaleString()}</p>
                    </div>
                    <span style={{ color: "#7c3aed", fontSize: 12, flexShrink: 0 }}>▶ Resume</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function EpisodeNav({ episodes, episode, startWatching }) {
  if (!episodes || episodes.length === 0) return null;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b5fa0", marginBottom: 10 }}>
        Episodes ({episodes.length})
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {episodes.map(ep => (
          <button 
            key={ep.mal_id} 
            className={`ep-btn ${ep.mal_id === episode ? "active" : ""}`} 
            onClick={() => startWatching(ep.mal_id)}
            title={ep.title || `Episode ${ep.mal_id}`}
          >
            {ep.mal_id}
          </button>
        ))}
      </div>
    </div>
  );
}