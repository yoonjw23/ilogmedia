/**
 * URL 메타데이터 (유튜브 oEmbed, 기사 HTML og/meta 파싱)
 */

/** @typedef {'youtube'|'article'|'podcast'|'book'|'other'} MediaType */

/**
 * @typedef {Object} MediaMetadata
 * @property {string} [title]
 * @property {string} [thumbnail]
 * @property {MediaType} [type]
 * @property {string} [publishedAt] YYYY-MM-DD
 */

/** @param {string} url */
export function detectMediaType(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (
      host.includes("news") ||
      host.includes("naver") ||
      host.includes("daum") ||
      host.includes("chosun") ||
      host.includes("joins") ||
      host.includes("hani") ||
      host.includes("mk.co") ||
      host.includes("sina") ||
      host.includes("163.com") ||
      host.includes("qq.com") ||
      host.includes("caixin") ||
      host.includes("ftchinese") ||
      host.includes("bbc.com") ||
      host.includes("reuters") ||
      host.includes("economist.com") ||
      host.includes("ft.com") ||
      host.includes("wsj.com") ||
      host.includes("nytimes.com") ||
      host.includes("bloomberg.com")
    ) {
      return "article";
    }
    if (host.includes("podcast") || host.includes("spotify") || host.includes("apple.com/podcast")) {
      return "podcast";
    }
  } catch {
    /* ignore */
  }
  return "article";
}

/** @param {string} url */
function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (u.searchParams.has("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(embed|shorts|v)\/([^/?]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

/** 유료·로그인 필요 미리보기 호스트 (아카이브 대신 원본 URL + 로그인 창 사용) */
const PAYWALLED_PREVIEW_HOSTS = [
  "economist.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "bloomberg.com",
  "washingtonpost.com",
  "ftchinese.com",
];

/** @param {string} url */
export function isPaywalledPreviewHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return PAYWALLED_PREVIEW_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
}

/** @param {string} url — 미리보기 iframe용 embed URL (원본 URL, 아카이브 미사용) */
export function getContentPreviewEmbedUrl(url) {
  try {
    const type = detectMediaType(url);

    if (type === "youtube") {
      const id = youtubeVideoId(url);
      return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1` : null;
    }

    return url;
  } catch {
    return null;
  }
}

/** @param {string} raw */
export function toDateInputValue(raw) {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (/^\d{8}$/.test(cleaned)) {
    const iso = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    const d0 = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d0.getTime())) return iso;
  }
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  const enMonth = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (enMonth) {
    const dEn = new Date(`${enMonth[1]} ${enMonth[2]}, ${enMonth[3]}T12:00:00`);
    if (!Number.isNaN(dEn.getTime())) return dEn.toISOString().slice(0, 10);
  }
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  const m = cleaned.match(/(\d{4})[./년\-](\d{1,2})[./월\-](\d{1,2})/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const d2 = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d2.getTime())) return iso;
  }
  return undefined;
}

/** @param {string} text "3 days ago" 등 → YYYY-MM-DD */
function publishedDateFromRelativeAgo(text) {
  const m = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const d = new Date();
  if (unit === "month") d.setMonth(d.getMonth() - n);
  else if (unit === "year") d.setFullYear(d.getFullYear() - n);
  else {
    const ms = {
      second: 1000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
    }[unit];
    if (!ms) return undefined;
    d.setTime(d.getTime() - n * ms);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * HTML·Jina 마크다운 등 페이지 텍스트에서 게시·업로드일 추출 (서버 없이 동작)
 * @param {string} text
 */
export function extractPublishedDateFromPageText(text) {
  if (!text) return undefined;

  const absolutePatterns = [
    /\d[\d,.]*\s+views\s*•\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /Streamed\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(?:^|\n)\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s*(?:\n|•|$)/m,
    /입력[_\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/,
    /수정[_\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/,
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
    /"uploadDate"\s*:\s*"([^"]+)"/,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /itemprop=["']uploadDate["'][^>]+content=["']([^"']+)["']/i,
  ];

  for (const re of absolutePatterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m.length >= 4 && /^\d{4}$/.test(m[1])) {
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const d = toDateInputValue(iso);
      if (d) return d;
    }
    const d = toDateInputValue(m[1]);
    if (d) return d;
  }

  const viewsAgo = text.match(/\d[\d,.]*\s+views\s+(\d+)\s+(day|week|month|year)s?\s+ago/i);
  if (viewsAgo) {
    const rel = publishedDateFromRelativeAgo(`${viewsAgo[1]} ${viewsAgo[2]} ago`);
    if (rel) return rel;
  }

  return undefined;
}

/** @param {string} text */
function extractTitleFromPageText(text) {
  const jina = text.match(/^Title:\s*(.+)$/m);
  if (jina?.[1]) return jina[1].trim();
  return extractTitleFromHtml(text);
}

/** @param {string} slug */
function humanizeArticleSlug(slug) {
  const small = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "even",
    "is",
    "are",
    "was",
    "were",
  ]);
  const acronyms = {
    maga: "MAGA",
    gdp: "GDP",
    usa: "USA",
    uk: "UK",
    eu: "EU",
    ai: "AI",
  };
  const words = slug
    .replace(/\.[a-z]+$/, "")
    .split("-")
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (acronyms[lower]) return acronyms[lower];
      if (i > 0 && small.has(lower)) return lower;
      if (lower === "americas") return "America's";
      if (lower === "chinas") return "China's";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** @param {string} rss @param {string} articleUrl */
function parseRssItemTitle(rss, articleUrl) {
  const norm = articleUrl.replace(/\/$/, "");
  const items = rss.split(/<item\b/i).slice(1);
  for (const item of items) {
    if (!item.includes(norm)) continue;
    const m =
      item.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i) ||
      item.match(/<title>([^<]+)<\/title>/i);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

/** @param {string} html */
function extractEconomistImageFromHtml(html) {
  const m = html.match(
    /content-assets\/images\/([A-Za-z0-9_]+\.(?:jpg|jpeg|png|webp))/i
  );
  if (m) return `https://www.economist.com/content-assets/images/${m[1]}`;
  return undefined;
}

/** @param {string} url */
async function fetchEconomistArticleImage(url) {
  const archive = `https://web.archive.org/web/0/${url}`;
  const proxy = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(archive)}`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 18000);
  try {
    const res = await fetch(proxy, { signal: ctrl.signal });
    const html = await res.text();
    if (res.ok && html.length > 500) {
      return extractEconomistImageFromHtml(html);
    }
  } catch {
    /* fall through */
  } finally {
    window.clearTimeout(timer);
  }

  try {
    const html = await fetchPageHtml(archive);
    return extractEconomistImageFromHtml(html);
  } catch {
    return undefined;
  }
}

/** @param {string} url @param {MediaMetadata} meta */
async function enrichEconomistMetadata(url, meta) {
  if (!url.includes("economist.com")) return meta;
  /** @type {MediaMetadata} */
  const out = { ...meta, type: meta.type || "article" };

  try {
    const section = new URL(url).pathname.split("/").filter(Boolean)[0] || "leaders";
    const rss = await fetchPageHtml(`https://www.economist.com/${section}/rss.xml`);
    const rssTitle = parseRssItemTitle(rss, url);
    if (rssTitle) out.title = rssTitle;
  } catch {
    /* ignore */
  }

  const needsImage =
    !out.thumbnail || out.thumbnail.includes("google-search-logo");
  if (needsImage) {
    const fromServer = await fetchMetadataFromServer(url);
    if (
      fromServer?.thumbnail &&
      !fromServer.thumbnail.includes("google-search-logo")
    ) {
      out.thumbnail = fromServer.thumbnail;
    } else {
      const img = await fetchEconomistArticleImage(url);
      if (img) out.thumbnail = img;
    }
  }

  return out;
}

/**
 * Cloudflare·구독 차단 사이트 — URL만으로 제목·날짜 추정 (The Economist 등)
 * @param {string} url
 * @returns {MediaMetadata | null}
 */
export function extractMetadataFromArticleUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    const pathDate = u.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
    const publishedAt = pathDate
      ? `${pathDate[1]}-${pathDate[2]}-${pathDate[3]}`
      : undefined;

    if (host.includes("economist.com")) {
      const slugMatch = u.pathname.match(/\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/);
      const slug = slugMatch?.[1];
      const section = u.pathname.split("/").filter(Boolean)[0];
      const title = slug ? humanizeArticleSlug(slug) : undefined;
      const sectionLabel = section
        ? section.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())
        : "";
      return {
        type: /** @type {MediaType} */ ("article"),
        title: title
          ? sectionLabel && !title.toLowerCase().includes(sectionLabel.toLowerCase())
            ? `${title} (${sectionLabel})`
            : title
          : undefined,
        publishedAt,
      };
    }

    if (host.includes("ft.com") && publishedAt) {
      const slugMatch = u.pathname.match(/\/([^/?#]+)$/);
      const slug = slugMatch?.[1];
      if (slug && !/^\d+$/.test(slug)) {
        return {
          type: /** @type {MediaType} */ ("article"),
          title: humanizeArticleSlug(slug),
          publishedAt,
        };
      }
    }

    if (publishedAt && host.includes("wsj.com")) {
      const slugMatch = u.pathname.match(/\/articles\/([^/?#]+)/);
      if (slugMatch?.[1]) {
        return {
          type: /** @type {MediaType} */ ("article"),
          title: humanizeArticleSlug(slugMatch[1]),
          publishedAt,
        };
      }
    }

    if (publishedAt) {
      const slugMatch = u.pathname.match(/\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/);
      if (slugMatch?.[1]) {
        return {
          type: /** @type {MediaType} */ ("article"),
          title: humanizeArticleSlug(slugMatch[1]),
          publishedAt,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** URL 경로·쿼리에서 게시일 추출 (다음 v/20260522…, 네이버·이코노미스트 경로 등) */
export function extractPublishedDateFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    const pathYmd = u.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
    if (pathYmd) {
      const iso = `${pathYmd[1]}-${pathYmd[2]}-${pathYmd[3]}`;
      const d = new Date(`${iso}T12:00:00`);
      if (!Number.isNaN(d.getTime())) return iso;
    }

    const daum = u.pathname.match(/\/v\/(\d{4})(\d{2})(\d{2})/);
    if (daum) {
      return `${daum[1]}-${daum[2]}-${daum[3]}`;
    }

    if (host.includes("naver.com") || host.includes("pstatic.net")) {
      const inPath = url.match(/\/(\d{4})[/.-](\d{2})[/.-](\d{2})\//);
      if (inPath) {
        return `${inPath[1]}-${inPath[2]}-${inPath[3]}`;
      }
    }

    const ymd = url.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:\d{4,})?(?:[^\d]|$)/);
    if (ymd && host.includes("daum.net")) {
      const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
      const d = new Date(`${iso}T12:00:00`);
      if (!Number.isNaN(d.getTime())) return iso;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** @param {string} html @param {string} key */
function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return undefined;
}

/** @param {string} s */
function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** @param {string} html */
function extractTitleFromHtml(html) {
  return (
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    metaContent(html, "title") ||
    (() => {
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m?.[1] ? decodeHtmlEntities(m[1].trim()) : undefined;
    })()
  );
}

/** @param {string} html */
function extractThumbnailFromHtml(html) {
  return (
    metaContent(html, "og:image") ||
    metaContent(html, "og:image:url") ||
    metaContent(html, "twitter:image")
  );
}

/** @param {unknown} node */
function dateFromJsonLdNode(node) {
  if (!node || typeof node !== "object") return undefined;
  const o = /** @type {Record<string, unknown>} */ (node);
  const keys = ["datePublished", "uploadDate", "dateCreated", "published"];
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string") {
      const d = toDateInputValue(v);
      if (d) return d;
    }
  }
  if (Array.isArray(o["@graph"])) {
    for (const item of o["@graph"]) {
      const d = dateFromJsonLdNode(item);
      if (d) return d;
    }
  }
  return undefined;
}

/** @param {string} html */
function extractPublishedDateFromJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        const d = dateFromJsonLdNode(item);
        if (d) return d;
      }
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return undefined;
}

/** @param {string} html */
function extractPublishedDateFromHtml(html) {
  const fromText = extractPublishedDateFromPageText(html);
  if (fromText) return fromText;

  const jsonLd = extractPublishedDateFromJsonLd(html);
  if (jsonLd) return jsonLd;

  const metaKeys = [
    "article:published_time",
    "article:published",
    "og:published_time",
    "og:article:published_time",
    "og:release_date",
    "publishdate",
    "pubdate",
    "publish_date",
    "sailthru.date",
    "parsely-pub-date",
    "date",
    "DC.date.issued",
    "dcterms.created",
    "rnews:publishDate",
    "dd:published_time",
    "dd:publish_time",
  ];
  for (const key of metaKeys) {
    const v = metaContent(html, key);
    const d = toDateInputValue(v || "");
    if (d) return d;
  }

  const patterns = [
    /"uploadDate"\s*:\s*"([^"]+)"/,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /"publishDate"\s*:\s*"([^"]+)"/,
    /"pubDate"\s*:\s*"([^"]+)"/,
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /class=["'][^"']*date[^"']*["'][^>]*>[^<]*?(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/i,
    /입력[_\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/,
    /수정[_\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/,
    /发布时间[^0-9]{0,20}(\d{4}[年./-]\d{1,2}[月./-]\d{1,2})/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    if (m.length >= 4 && /年/.test(m[0])) {
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const d = toDateInputValue(iso);
      if (d) return d;
    }
    if (m.length >= 4 && /^\d{4}$/.test(m[1])) {
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const d = toDateInputValue(iso);
      if (d) return d;
    }
    const value = toDateInputValue(m[1]);
    if (value) return value;
  }
  return undefined;
}

/** @type {string | null | undefined} */
let metaApiBaseCache;

/** 로컬 server.py(8080) — 있으면 사용, 없어도 앱은 iCloud·공개 프록시로 동작 */
async function getMetaApiBase() {
  if (metaApiBaseCache !== undefined) return metaApiBaseCache;
  /** @type {string[]} */
  const candidates = [];
  if (typeof location !== "undefined" && location.origin?.startsWith("http")) {
    candidates.push("");
    if (!candidates.includes(location.origin)) candidates.push(location.origin);
  }
  for (const host of [
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://ilogmedia.local:8080",
  ]) {
    if (!candidates.includes(host)) candidates.push(host);
  }

  for (const base of candidates) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1200);
    try {
      const res = await fetch(`${base}/api/health`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (res.ok) {
        metaApiBaseCache = base;
        return base;
      }
    } catch {
      /* try next */
    } finally {
      window.clearTimeout(timer);
    }
  }
  metaApiBaseCache = "";
  return "";
}

/** 로컬 서버 curl (선택) — 집 맥에서 server.py 켜 두면 더 안정적 */
async function fetchMetadataFromServer(url) {
  const base = await getMetaApiBase();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${base}/api/meta?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;
    /** @type {MediaMetadata} */
    const meta = { type: detectMediaType(url) };
    if (data.title) meta.title = data.title;
    if (data.thumbnail) meta.thumbnail = data.thumbnail;
    if (data.publishedAt) meta.publishedAt = data.publishedAt;
    if (meta.title || meta.thumbnail || meta.publishedAt) return meta;
    return null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** @param {string} url @returns {Promise<string>} HTML 또는 Jina 마크다운 */
async function fetchPageHtml(url) {
  const proxies = [
    (u) => `https://r.jina.ai/${u}`,
    (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];
  let lastErr;
  for (const build of proxies) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(build(url), { signal: ctrl.signal });
      let text = await res.text();
      if (build(url).includes("allorigins.win/get")) {
        try {
          const wrapped = JSON.parse(text);
          if (wrapped?.contents) text = wrapped.contents;
        } catch {
          /* raw */
        }
      }
      if (res.ok && text.length > 300) return text;
    } catch (e) {
      lastErr = e;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("page fetch failed");
}

/** @param {string} raw */
function extractReaderTextFromPage(raw) {
  const markdown = raw.match(/Markdown Content:\s*\n([\s\S]+)/i)?.[1];
  let text = (markdown ?? raw).trim();
  text = text
    .replace(/^Title:\s*.+$/gm, "")
    .replace(/^URL Source:\s*.+$/gm, "")
    .replace(/^Published Time:\s*.+$/gm, "")
    .replace(/^Markdown Content:\s*$/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

/** @param {string} url @returns {Promise<string>} 읽기·번역용 본문 텍스트 */
export async function fetchArticleReaderText(url) {
  const raw = await fetchPageHtml(url);
  return extractReaderTextFromPage(raw);
}

/** @param {string} url */
async function fetchArticleFromHtml(url) {
  const html = await fetchPageHtml(url);
  return {
    title: extractTitleFromPageText(html),
    thumbnail: extractThumbnailFromHtml(html),
    publishedAt:
      extractPublishedDateFromPageText(html) ||
      extractPublishedDateFromHtml(html) ||
      extractPublishedDateFromUrl(url),
    type: /** @type {MediaType} */ ("article"),
  };
}

/** @param {string} url */
async function fetchNoembed(url) {
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!res.ok) return {};
    const data = await res.json();
    if (data.error) return {};
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      publishedAt: toDateInputValue(data.upload_date),
    };
  } catch {
    return {};
  }
}

/** @param {string} url */
async function fetchYoutubePageDate(url) {
  try {
    const page = await fetchPageHtml(url);
    return (
      extractPublishedDateFromPageText(page) ||
      extractPublishedDateFromJsonLd(page) ||
      extractPublishedDateFromHtml(page)
    );
  } catch {
    return undefined;
  }
}

/** @param {string} url */
async function fetchYoutubeMetadata(url) {
  const id = youtubeVideoId(url);
  const thumbnail = id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : undefined;
  /** @type {MediaMetadata} */
  const result = { thumbnail, type: /** @type {MediaType} */ ("youtube") };

  const [oembedRes, noembed, pageDate] = await Promise.all([
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`).catch(
      () => null
    ),
    fetchNoembed(url),
    fetchYoutubePageDate(url),
  ]);

  if (oembedRes?.ok) {
    const data = await oembedRes.json();
    if (data.title) result.title = data.title;
    if (data.thumbnail_url) result.thumbnail = data.thumbnail_url;
  } else if (noembed.title) {
    result.title = noembed.title;
  }

  if (noembed.thumbnail) result.thumbnail = noembed.thumbnail;

  result.publishedAt =
    noembed.publishedAt || pageDate || result.publishedAt;

  return result;
}

/**
 * 게시일만 서버·HTML에서 재시도 (제목·썸네일은 이미 있을 때)
 * @param {string} url
 * @returns {Promise<string | undefined>}
 */
export async function fetchPublishedDate(url) {
  const fromPath = extractMetadataFromArticleUrl(url);
  if (fromPath?.publishedAt) return fromPath.publishedAt;

  const urlDate = extractPublishedDateFromUrl(url);
  if (urlDate) return urlDate;

  if (detectMediaType(url) === "youtube") {
    const pageDate = await fetchYoutubePageDate(url);
    if (pageDate) return pageDate;
  } else {
    try {
      const page = await fetchPageHtml(url);
      const fromPage =
        extractPublishedDateFromPageText(page) || extractPublishedDateFromHtml(page);
      if (fromPage) return fromPage;
    } catch {
      /* fall through */
    }
  }

  const fromServer = await fetchMetadataFromServer(url);
  if (fromServer?.publishedAt) return fromServer.publishedAt;

  if (detectMediaType(url) === "youtube") {
    const yt = await fetchYoutubeMetadata(url);
    if (yt.publishedAt) return yt.publishedAt;
  }

  return undefined;
}

/** @param {MediaMetadata} a @param {MediaMetadata} b */
function mergeMetadata(a, b) {
  return {
    type: a.type || b.type,
    title: a.title || b.title,
    thumbnail: a.thumbnail || b.thumbnail,
    publishedAt: a.publishedAt || b.publishedAt,
  };
}

/** 서버 없이 클라이언트만으로 메타 수집 */
async function fetchMetadataClient(url) {
  const type = detectMediaType(url);
  const urlDate = extractPublishedDateFromUrl(url);

  if (type === "youtube") {
    const yt = await fetchYoutubeMetadata(url);
    return { ...yt, type: /** @type {MediaType} */ ("youtube") };
  }

  const [htmlMeta, noembed] = await Promise.all([
    fetchArticleFromHtml(url).catch(() => ({})),
    fetchNoembed(url),
  ]);

  return {
    type,
    title: htmlMeta.title || noembed.title,
    thumbnail: htmlMeta.thumbnail || noembed.thumbnail,
    publishedAt: htmlMeta.publishedAt || noembed.publishedAt || urlDate,
  };
}

/**
 * @param {string} url
 * @returns {Promise<MediaMetadata>}
 */
export async function fetchMetadata(url) {
  const type = detectMediaType(url);
  const urlDate = extractPublishedDateFromUrl(url);
  const fromArticleUrl = extractMetadataFromArticleUrl(url);

  const [client, fromServer] = await Promise.all([
    fetchMetadataClient(url),
    fetchMetadataFromServer(url).catch(() => null),
  ]);

  /** @type {MediaMetadata} */
  let result = mergeMetadata(
    mergeMetadata(fromArticleUrl || {}, { type, publishedAt: urlDate, ...client }),
    fromServer || {}
  );

  if (type === "youtube" && !result.publishedAt) {
    const pageDate = await fetchYoutubePageDate(url);
    if (pageDate) result = { ...result, publishedAt: pageDate };
  }

  if (!result.publishedAt) {
    result.publishedAt = urlDate;
  }

  if (url.includes("economist.com")) {
    result = await enrichEconomistMetadata(url, result);
  }

  return result;
}
