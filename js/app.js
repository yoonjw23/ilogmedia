import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";
import { initAuth, signInWithGoogle, signOut, getCurrentUser, onAuthChange } from "./auth.js";
import {
  loadEntries,
  saveEntries,
  saveEntry,
  deleteEntry,
  importEntries,
  mergeEntriesById,
  initFirestore,
  newId,
  parseTags,
  formatDate,
  sortEntries,
  isMobileLayout,
  DEFAULT_CATEGORIES,
  MEDIA_LABELS,
  MEDIA_ICONS,
} from "./storage.js";
import {
  detectMediaType,
  fetchMetadata,
  fetchPublishedDate,
  getContentPreviewEmbedUrl,
  isPaywalledPreviewHost,
  isIframeBlockedPreviewHost,
  fetchArticleReaderText,
  extractPublishedDateFromUrl,
} from "./metadata.js";
import {
  showTranslatePopover,
  hideTranslatePopover,
  textFromReaderClick,
  renderReaderHtml,
} from "./translate.js";

/** @type {import('./storage.js').ContentEntry[]} */
let entries = [];

let currentFilter = "all";
let searchQuery = "";
let editingId = null;
let archiveFocus = null;
let archiveSort = "recorded";
let selectedCategories = new Set();
let metaFetchTimer = null;
let metaFetchInFlight = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const feedList = $("#feed-list");
const feedEmpty = $("#feed-empty");
const archiveContent = $("#archive-content");
const archiveEmpty = $("#archive-empty");
const dialog = /** @type {HTMLDialogElement} */ ($("#entry-dialog"));
const form = $("#entry-form");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const PREFER_CHROME_KEY = "media-notes-open-in-chrome";

function prefersChromeOpen() {
  return localStorage.getItem(PREFER_CHROME_KEY) === "1";
}

function openContentUrl(url) {
  if (!url) return;
  if (prefersChromeOpen()) {
    const chromeUrl = url.startsWith("http")
      ? `googlechrome://${url.replace(/^https?:\/\//, "")}`
      : url;
    const opened = window.open(chromeUrl, "_blank", "noopener,noreferrer");
    if (opened) return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderContentOpenLink(entry, innerHtml) {
  const url = entry.url?.trim();
  if (!url) return innerHtml;
  return `<a class="content-open-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="원본 콘텐츠 열기 (새 탭)">${innerHtml}</a>`;
}

function getFilteredEntries() {
  let list = sortEntries(entries);
  if (currentFilter !== "all") {
    list = list.filter((e) => e.status === currentFilter);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter((e) => {
      const hay = [e.title, e.summary, ...e.keywords, ...e.categories, MEDIA_LABELS[e.type]]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

function setFeedEmptyVisible(visible) {
  if (!feedEmpty) return;
  feedEmpty.classList.toggle("is-visible", visible);
  feedEmpty.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderFeed() {
  const list = getFilteredEntries();
  const showEmpty = list.length === 0;
  setFeedEmptyVisible(showEmpty);
  if (feedList) feedList.hidden = showEmpty;
  if (showEmpty) {
    feedList.innerHTML = "";
    return;
  }
  feedList.innerHTML = list.map(renderEntryCard).join("");
}

function formatRecordedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("ko-KR", {
    year: "2-digit",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function youtubeThumbFromUrl(url) {
  try {
    const u = new URL(url);
    let id =
      u.hostname === "youtu.be"
        ? u.pathname.slice(1).split("/")[0]
        : u.searchParams.get("v");
    if (!id) {
      const m = u.pathname.match(/\/(embed|shorts|v)\/([^/?]+)/);
      id = m?.[2] ?? null;
    }
    return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : undefined;
  } catch {
    return undefined;
  }
}

function getEntryThumbnailUrl(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  if (entry.type === "youtube" && entry.url) return youtubeThumbFromUrl(entry.url);
  return undefined;
}

function renderThumbContent(entry, iconClass) {
  const src = getEntryThumbnailUrl(entry);
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" />`;
  }
  return `<span class="${iconClass}" aria-hidden="true">${MEDIA_ICONS[entry.type]}</span>`;
}

function renderEntryCard(entry) {
  const thumbSrc = getEntryThumbnailUrl(entry);
  const hasThumb = Boolean(thumbSrc);
  const thumb = renderThumbContent(entry, "entry-card__icon");

  const publishedLabel = entry.publishedAt
    ? `<span class="entry-card__published">(${formatDate(entry.publishedAt)})</span>`
    : "";

  const keywordTags = [
    ...entry.keywords.map(
      (k) =>
        `<button type="button" class="tag" data-topic-kind="keyword" data-topic-label="${escapeHtml(k)}">${escapeHtml(k)}</button>`
    ),
    ...entry.categories.map(
      (c) =>
        `<button type="button" class="tag tag--category" data-topic-kind="category" data-topic-label="${escapeHtml(c)}">${escapeHtml(c)}</button>`
    ),
  ];
  const keywordsHtml = keywordTags.length
    ? keywordTags.join("")
    : '<span class="entry-card__empty">—</span>';

  const summary = entry.summary
    ? escapeHtml(entry.summary.length > 120 ? `${entry.summary.slice(0, 120)}…` : entry.summary)
    : '<span class="entry-card__empty">—</span>';

  const statusBadge =
    entry.status === "watched"
      ? `<span class="badge badge--watched">watched</span>${entry.watchedAt ? `<span class="entry-card__status-date">${formatDate(entry.watchedAt)}</span>` : ""}`
      : `<span class="badge badge--to-watch">to watch</span>`;

  return `
    <article class="entry-card entry-card--compact entry-card--${entry.type}${hasThumb ? " entry-card--has-thumb" : ""}" data-id="${entry.id}" tabindex="0">
      <div class="entry-card__recorded" title="이 앱에 기록한 날짜·시간">
        <span class="entry-card__recorded-label">기록</span>
        <time class="entry-card__recorded-time" datetime="${escapeHtml(entry.createdAt)}">${formatRecordedAt(entry.createdAt)}</time>
      </div>
      <div class="entry-card__thumb">${renderContentOpenLink(entry, thumb)}</div>
      <div class="entry-card__body">
        <div class="entry-card__row entry-card__row--status">
          <span class="entry-card__label">시청여부</span>
          <span class="entry-card__value">${statusBadge}</span>
        </div>
        <div class="entry-card__row entry-card__row--title">
          <span class="entry-card__label">제목</span>
          <span class="entry-card__value entry-card__value--title">
            <strong class="entry-card__title-text">${escapeHtml(entry.title)}</strong>
            ${publishedLabel}
          </span>
        </div>
        <div class="entry-card__row">
          <span class="entry-card__label">주요내용</span>
          <span class="entry-card__value entry-card__value--summary">${summary}</span>
        </div>
        <div class="entry-card__row">
          <span class="entry-card__label">주요키워드</span>
          <span class="entry-card__value entry-card__value--tags">${keywordsHtml}</span>
        </div>
      </div>
    </article>
  `;
}

/* ── Archive ── */
function sortArchiveList(list) {
  const copy = [...list];
  switch (archiveSort) {
    case "published":
      return copy.sort((a, b) => {
        const da = a.publishedAt || "";
        const db = b.publishedAt || "";
        if (da !== db) return db.localeCompare(da);
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    case "type":
      return copy.sort((a, b) => {
        const t = a.type.localeCompare(b.type);
        if (t !== 0) return t;
        return a.title.localeCompare(b.title, "ko");
      });
    default:
      return sortEntries(copy);
  }
}

function entriesMatchingArchiveFocus() {
  if (!archiveFocus) return [];
  return entries.filter((e) => {
    if (archiveFocus.kind === "keyword") return e.keywords.includes(archiveFocus.label);
    return e.categories.includes(archiveFocus.label);
  });
}

function updateArchiveChrome() {
  const toolbar = $("#archive-toolbar");
  const intro = $("#archive-intro");
  const titleEl = $("#archive-focus-title");
  const countEl = $("#archive-focus-count");
  const sortEl = $("#archive-sort");

  if (archiveFocus && toolbar && intro) {
    toolbar.hidden = false;
    intro.hidden = true;
    const kindLabel = archiveFocus.kind === "keyword" ? "키워드" : "카테고리";
    if (titleEl) titleEl.textContent = `${kindLabel} · ${archiveFocus.label}`;
    const n = entriesMatchingArchiveFocus().length;
    if (countEl) countEl.textContent = `${n}개`;
    if (sortEl) sortEl.value = archiveSort;
  } else if (toolbar && intro) {
    toolbar.hidden = true;
    intro.hidden = false;
  }
}

function openArchiveFocus(kind, label) {
  archiveFocus = { kind, label };
  activateView("archive");
}

function clearArchiveFocus() {
  archiveFocus = null;
  renderArchive();
}

function renderArchive() {
  updateArchiveChrome();

  if (archiveFocus) {
    const list = sortArchiveList(entriesMatchingArchiveFocus());
    const showEmpty = list.length === 0;
    if (archiveEmpty) {
      archiveEmpty.classList.toggle("is-visible", showEmpty);
      archiveEmpty.setAttribute("aria-hidden", showEmpty ? "false" : "true");
      if (showEmpty) archiveEmpty.textContent = `「${archiveFocus.label}」에 해당하는 콘텐츠가 없습니다.`;
    }
    archiveContent.innerHTML = showEmpty
      ? ""
      : `<div class="archive-section archive-section--focused"><div class="archive-items">${list.map(renderArchiveItem).join("")}</div></div>`;
    return;
  }

  const withTags = entries.filter((e) => e.categories.length > 0 || e.keywords.length > 0);
  const showArchiveEmpty = withTags.length === 0;
  if (archiveEmpty) {
    archiveEmpty.classList.toggle("is-visible", showArchiveEmpty);
    archiveEmpty.setAttribute("aria-hidden", showArchiveEmpty ? "false" : "true");
    if (showArchiveEmpty) archiveEmpty.textContent = "아카이브를 만들려면 콘텐츠에 카테고리나 키워드를 추가하세요.";
  }
  if (!withTags.length) {
    archiveContent.innerHTML = "";
    return;
  }

  const byCategory = groupBy(withTags, (e) => e.categories);
  const byKeyword = groupBy(
    withTags.flatMap((e) => e.keywords.map((k) => ({ keyword: k, entry: e }))),
    (item) => [item.keyword],
    (item) => item.entry
  );

  let html = "";
  if (Object.keys(byCategory).length) {
    html += `<div class="archive-section"><h3 class="archive-section__title">카테고리별 <span class="archive-section__count">${entries.length}개 콘텐츠</span></h3>`;
    for (const [cat, items] of Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b, "ko"))) {
      html += renderArchiveGroup(cat, uniqueEntries(items), "category");
    }
    html += `</div>`;
  }
  if (Object.keys(byKeyword).length) {
    html += `<div class="archive-section"><h3 class="archive-section__title">키워드별</h3>`;
    for (const [kw, items] of Object.entries(byKeyword).sort(([a], [b]) => a.localeCompare(b, "ko"))) {
      html += renderArchiveGroup(kw, uniqueEntries(items), "keyword");
    }
    html += `</div>`;
  }
  archiveContent.innerHTML = html;
}

function uniqueEntries(items) {
  const seen = new Set();
  return items.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function groupBy(list, keyFn, valueFn = (x) => x) {
  const map = {};
  for (const item of list) {
    const keys = keyFn(item);
    const value = valueFn(item);
    for (const key of keys) {
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(value);
    }
  }
  return map;
}

function renderArchiveItem(e) {
  const hasThumb = Boolean(getEntryThumbnailUrl(e));
  const published = e.publishedAt ? ` · ${formatDate(e.publishedAt)}` : "";
  return `
    <div class="archive-item${hasThumb ? " archive-item--has-thumb" : ""}" data-id="${e.id}" role="button" tabindex="0">
      <div class="archive-item__thumb">${renderContentOpenLink(e, renderThumbContent(e, "archive-item__icon"))}</div>
      <div class="archive-item__body">
        <div class="archive-item__title">${escapeHtml(e.title)}</div>
        <div class="archive-item__sub">${MEDIA_LABELS[e.type]} · ${e.status === "watched" ? "watched" : "to watch"}${published}${e.watchedAt ? ` · 시청 ${formatDate(e.watchedAt)}` : ""}</div>
      </div>
    </div>`;
}

function renderArchiveGroup(label, items, topicKind) {
  const labelHtml = topicKind && label
    ? `<button type="button" class="archive-group__label" data-topic-kind="${topicKind}" data-topic-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`
    : `<p class="archive-group__label">${escapeHtml(label)}</p>`;
  return `<div class="archive-group">${labelHtml}<div class="archive-items">${items.map(renderArchiveItem).join("")}</div></div>`;
}

/* ── Dialog / Preview ── */
function renderCategoryChips() {
  const container = $("#category-chips");
  container.innerHTML = DEFAULT_CATEGORIES.map(
    (cat) =>
      `<button type="button" class="chip ${selectedCategories.has(cat) ? "chip--selected" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join("");
  container.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-category");
      if (!cat) return;
      if (selectedCategories.has(cat)) selectedCategories.delete(cat);
      else selectedCategories.add(cat);
      btn.classList.toggle("chip--selected");
    });
  });
}

const PAYWALL_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";
let previewReaderMode = false;
let previewReaderUrl = "";
let previewReaderLoading = false;

function previewLoginWindowName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `ilogmedia-login-${host}`;
  } catch {
    return `ilogmedia-login-site`;
  }
}

function openPreviewLoginWindow(url) {
  if (!url.startsWith("http")) return;
  const name = previewLoginWindowName(url);
  const win = window.open(url, name, "width=540,height=900,scrollbars=yes,resizable=yes");
  if (win) win.focus();
}

function clearContentPreview() {
  const iframe = $("#entry-preview-iframe");
  const reader = $("#entry-preview-reader");
  const empty = $("#entry-preview-empty");
  const openLink = $("#entry-preview-open");
  const loginBtn = $("#btn-preview-login");
  const readerBtn = $("#btn-preview-reader");
  const paywallNote = $("#entry-preview-paywall-note");
  const videoWrap = $("#entry-preview-video-wrap");
  const ytInfo = $("#entry-preview-yt-info");
  const articleWrap = $("#entry-preview-article-wrap");
  const articleIframe = $("#entry-preview-article-iframe");
  previewReaderMode = false;
  previewReaderUrl = "";
  previewReaderLoading = false;
  hideTranslatePopover();
  if (iframe) { iframe.removeAttribute("src"); iframe.removeAttribute("sandbox"); iframe.hidden = true; }
  if (reader) { reader.hidden = true; reader.innerHTML = ""; }
  if (empty) { empty.hidden = true; empty.setAttribute("aria-hidden", "true"); }
  if (openLink) openLink.hidden = true;
  if (loginBtn) loginBtn.hidden = true;
  if (readerBtn) { readerBtn.hidden = true; readerBtn.textContent = "번역 읽기"; readerBtn.classList.remove("btn--active"); }
  if (paywallNote) paywallNote.hidden = true;
  if (videoWrap) videoWrap.hidden = true;
  if (ytInfo) ytInfo.hidden = true;
  if (articleWrap) articleWrap.hidden = true;
  if (articleIframe) { articleIframe.removeAttribute("src"); articleIframe.hidden = true; }
}

async function loadPreviewReader(url) {
  const reader = $("#entry-preview-reader");
  const iframe = $("#entry-preview-iframe");
  if (!reader || previewReaderLoading) return;
  previewReaderLoading = true;
  previewReaderUrl = url;
  if (iframe) iframe.hidden = true;
  reader.hidden = false;
  reader.innerHTML = `<p class="entry-preview__reader-loading">본문을 불러오는 중…</p>`;
  try {
    const text = await fetchArticleReaderText(url);
    if (previewReaderUrl !== url || !previewReaderMode) return;
    reader.innerHTML =
      `<p class="entry-preview__reader-hint">단어를 드래그하거나 클릭하면 번역됩니다. 중국어는 병음·성조 표시 · <kbd>Cmd+Shift+T</kbd> (복사 후 번역)</p>` +
      renderReaderHtml(text);
  } catch {
    if (previewReaderUrl === url && previewReaderMode) {
      reader.innerHTML = `<p class="entry-preview__reader-empty">본문을 불러오지 못했습니다.</p>`;
    }
  } finally {
    previewReaderLoading = false;
  }
}

function setPreviewReaderMode(on) {
  const url = $("#entry-url").value.trim();
  const iframe = $("#entry-preview-iframe");
  const reader = $("#entry-preview-reader");
  const readerBtn = $("#btn-preview-reader");
  previewReaderMode = on;
  if (readerBtn) {
    readerBtn.textContent = on ? "원본 보기" : "번역 읽기";
    readerBtn.classList.toggle("btn--active", on);
  }
  if (!url.startsWith("http") || detectMediaType(url) === "youtube") {
    previewReaderMode = false;
    if (reader) reader.hidden = true;
    return;
  }
  if (on) {
    loadPreviewReader(url);
  } else {
    previewReaderUrl = "";
    hideTranslatePopover();
    if (reader) { reader.hidden = true; reader.innerHTML = ""; }
    if (iframe && iframe.getAttribute("src")) iframe.hidden = false;
    else updateContentPreview();
  }
}

function togglePreviewReaderMode() {
  setPreviewReaderMode(!previewReaderMode);
}

async function handleReaderTranslate(e) {
  const reader = $("#entry-preview-reader");
  if (!reader || reader.hidden) return;
  const text = textFromReaderClick(e, reader);
  if (!text) return;
  await showTranslatePopover(text, e.clientX, e.clientY);
}

async function translateFromClipboard() {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) { alert("먼저 기사에서 단어를 선택한 뒤 복사(Cmd+C)하세요."); return; }
    const rect = $("#entry-preview-panel")?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width * 0.4 : window.innerWidth * 0.35;
    const y = rect ? rect.top + 80 : 120;
    await showTranslatePopover(text.slice(0, 120), x, y);
  } catch {
    alert("클립보드 접근이 필요합니다.");
  }
}

function updateContentPreview() {
  if (isMobileLayout()) return;
  const url = $("#entry-url").value.trim();
  const iframe = $("#entry-preview-iframe");
  const reader = $("#entry-preview-reader");
  const empty = $("#entry-preview-empty");
  const openLink = $("#entry-preview-open");
  const loginBtn = $("#btn-preview-login");
  const readerBtn = $("#btn-preview-reader");
  const paywallNote = $("#entry-preview-paywall-note");
  const videoWrap = $("#entry-preview-video-wrap");
  const ytInfo = $("#entry-preview-yt-info");
  const articleWrap = $("#entry-preview-article-wrap");
  const articleIframe = $("#entry-preview-article-iframe");
  if (!iframe || !empty) return;

  if (!url.startsWith("http")) { clearContentPreview(); return; }

  const isYoutube = detectMediaType(url) === "youtube";
  if (readerBtn) readerBtn.hidden = isYoutube;

  if (previewReaderMode && !isYoutube) {
    if (previewReaderUrl !== url) loadPreviewReader(url);
    return;
  }

  const paywalled = isPaywalledPreviewHost(url);
  const iframeBlocked = isIframeBlockedPreviewHost(url);
  const embedUrl = getContentPreviewEmbedUrl(url);

  if (isYoutube && embedUrl) {
    if (iframe.getAttribute("src") !== embedUrl) iframe.src = embedUrl;
    iframe.removeAttribute("sandbox");
    iframe.hidden = false;
    if (videoWrap) videoWrap.hidden = false;
    if (ytInfo) ytInfo.hidden = false;
    if (articleWrap) articleWrap.hidden = true;
    if (reader) reader.hidden = true;
    empty.hidden = true;
    loadYoutubeInfo(url);
  } else if (embedUrl) {
    if (iframeBlocked) {
      setPreviewReaderMode(true);
      return;
    }
    if (articleIframe) {
      if (articleIframe.getAttribute("src") !== embedUrl) articleIframe.src = embedUrl;
      if (paywalled) articleIframe.setAttribute("sandbox", PAYWALL_PREVIEW_SANDBOX);
      else articleIframe.removeAttribute("sandbox");
      articleIframe.hidden = false;
    }
    if (articleWrap) articleWrap.hidden = false;
    if (videoWrap) videoWrap.hidden = true;
    if (ytInfo) ytInfo.hidden = true;
    if (reader) reader.hidden = true;
    empty.hidden = true;
  } else {
    if (videoWrap) videoWrap.hidden = true;
    if (ytInfo) ytInfo.hidden = true;
    if (articleWrap) articleWrap.hidden = true;
    if (reader) reader.hidden = true;
    empty.hidden = true;
  }

  if (openLink) { openLink.href = url; openLink.hidden = false; }
  if (loginBtn) loginBtn.hidden = !paywalled;
  if (paywallNote) paywallNote.hidden = !paywalled;
}

let _ytInfoLoadedUrl = "";

async function loadYoutubeInfo(url) {
  if (_ytInfoLoadedUrl === url) return;
  _ytInfoLoadedUrl = url;

  const titleEl = $("#yt-info-title");
  const metaEl = $("#yt-info-meta");
  const descEl = $("#yt-info-description");
  const commentsEl = $("#yt-info-comments");
  if (!titleEl) return;

  titleEl.textContent = "불러오는 중…";
  metaEl.textContent = "";
  descEl.textContent = "";
  if (commentsEl) commentsEl.innerHTML = `<p class="yt-info__placeholder">댓글을 불러오는 중...</p>`;

  const id = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1];
  if (!id) {
    titleEl.textContent = $("#entry-title").value || "영상 ID를 찾을 수 없습니다";
    return;
  }

  try {
    const res = await fetch(`/.netlify/functions/youtube-date?v=${id}`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    if (_ytInfoLoadedUrl !== url) return;

    titleEl.textContent = data.title || $("#entry-title").value || "제목 없음";

    const metaParts = [];
    if (data.channel) metaParts.push(data.channel);
    if (data.publishedAt) metaParts.push(data.publishedAt);
    if (data.viewCount) metaParts.push(`조회수 ${Number(data.viewCount).toLocaleString()}회`);
    metaEl.textContent = metaParts.join(" · ");

    descEl.textContent = data.description || "(설명 없음)";

    if (data.comments?.length > 0) {
      commentsEl.innerHTML = data.comments.map((c) =>
        `<div class="yt-info__comment">
          <div class="yt-info__comment-author">${escapeHtml(c.author)}</div>
          <div class="yt-info__comment-text">${escapeHtml(c.text)}</div>
          ${c.likes || c.time ? `<div class="yt-info__comment-meta">${[c.time, c.likes ? `👍 ${c.likes}` : ""].filter(Boolean).join(" · ")}</div>` : ""}
        </div>`
      ).join("") +
        `<a class="yt-info__link" href="${url}" target="_blank" rel="noopener noreferrer">YouTube에서 더 보기 →</a>`;
    } else {
      commentsEl.innerHTML = `<p class="yt-info__placeholder">댓글을 볼 수 없습니다</p>
        <a class="yt-info__link" href="${url}" target="_blank" rel="noopener noreferrer">YouTube에서 댓글 보기 →</a>`;
    }
  } catch {
    if (_ytInfoLoadedUrl === url) {
      titleEl.textContent = $("#entry-title").value || "정보를 가져올 수 없습니다";
      descEl.textContent = "";
      if (commentsEl) commentsEl.innerHTML =
        `<a class="yt-info__link" href="${url}" target="_blank" rel="noopener noreferrer">YouTube에서 보기 →</a>`;
    }
  }
}


function openDialog(id = null) {
  editingId = id;
  const entry = id ? entries.find((e) => e.id === id) : null;

  $("#dialog-title").textContent = entry ? "콘텐츠 수정" : "콘텐츠 추가";
  $("#btn-delete-entry").hidden = !entry;

  $("#entry-url").value = entry?.url ?? "";
  $("#entry-type").value = entry?.type ?? "youtube";
  $("#entry-status").value = entry?.status ?? "to_watch";
  $("#entry-title").value = entry?.title ?? "";
  $("#entry-published").value = entry?.publishedAt?.slice(0, 10) ?? "";
  $("#entry-watched-at").value = entry?.watchedAt?.slice(0, 10) ?? "";
  $("#entry-summary").value = entry?.summary ?? "";
  $("#entry-keywords").value = entry?.keywords?.join(", ") ?? "";
  $("#entry-category-custom").value = "";

  selectedCategories = new Set(entry?.categories ?? []);
  renderCategoryChips();
  toggleWatchedField();

  if (entry?.thumbnail) form.dataset.pendingThumbnail = entry.thumbnail;
  else delete form.dataset.pendingThumbnail;

  dialog.classList.toggle("dialog--form-only", isMobileLayout());
  if (isMobileLayout()) clearContentPreview();
  else updateContentPreview();
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
  dialog.classList.remove("dialog--form-only");
  editingId = null;
  form.reset();
  selectedCategories = new Set();
  clearContentPreview();
}

function toggleWatchedField() {
  const status = $("#entry-status").value;
  const field = $("#field-watched-at");
  field.hidden = status !== "watched";
  if (status === "watched" && !$("#entry-watched-at").value) {
    $("#entry-watched-at").value = new Date().toISOString().slice(0, 10);
  }
}

/* ── Auth UI ── */
function updateAuthUI(user) {
  const loading = $("#loading-screen");
  const loginSection = $("#login-section");
  const appSection = $("#app");
  if (loading) loading.hidden = true;
  if (user) {
    if (loginSection) loginSection.hidden = true;
    if (appSection) appSection.hidden = false;
    const badge = $("#user-badge");
    if (badge) {
      badge.textContent = user.displayName || user.email || "사용자";
      badge.title = user.email || "";
    }
  } else {
    if (loginSection) loginSection.hidden = false;
    if (appSection) appSection.hidden = true;
  }
}

/* ── Persist ── */
async function persist() {
  try {
    await saveEntries(entries);
  } catch (e) {
    alert(e instanceof Error ? e.message : "저장에 실패했습니다.");
    return;
  }
  updateStorageBadge();
  renderFeed();
  renderArchive();
}

function updateStorageBadge() {
  const el = $("#storage-badge");
  if (!el) return;
  const n = entries.length;
  el.textContent = `클라우드 · ${n}개`;
  el.dataset.mode = "onedrive";
}

function activateView(view) {
  const tab = $(`.tabs__item[data-view="${view}"]`);
  if (!tab) return;
  $$(".tabs__item").forEach((t) => {
    t.classList.toggle("tabs__item--active", t === tab);
    t.setAttribute("aria-selected", t === tab ? "true" : "false");
  });
  $("#view-feed").classList.toggle("view--active", view === "feed");
  $("#view-feed").hidden = view !== "feed";
  $("#view-archive").classList.toggle("view--active", view === "archive");
  $("#view-archive").hidden = view !== "archive";
  if (view === "archive") renderArchive();
}

/* ── Metadata fetch ── */
function applyMetadataToForm(meta) {
  const isNew = !editingId;
  if (meta.type) $("#entry-type").value = meta.type;
  if (meta.title && (isNew || !$("#entry-title").value.trim())) {
    $("#entry-title").value = meta.title;
  }
  if (meta.thumbnail) form.dataset.pendingThumbnail = meta.thumbnail;
  if (meta.publishedAt && (isNew || !$("#entry-published").value.trim())) {
    $("#entry-published").value = meta.publishedAt;
  }
}

async function ensurePublishedDateOnForm(url) {
  if (!url || $("#entry-published").value.trim()) return;
  const date = await fetchPublishedDate(url);
  if (date && !$("#entry-published").value.trim()) {
    $("#entry-published").value = date;
  }
}

function needsMetadataFetch() {
  return (
    !$("#entry-title").value.trim() ||
    !form.dataset.pendingThumbnail ||
    !$("#entry-published").value.trim()
  );
}

async function handleFetchMeta({ silent = false } = {}) {
  const url = $("#entry-url").value.trim();
  if (!url) return;
  const btn = $("#btn-fetch-meta");
  if (!silent) { btn.textContent = "가져오는 중…"; btn.setAttribute("disabled", "true"); }
  try {
    const meta = await fetchMetadata(url);
    applyMetadataToForm(meta);
    $("#entry-type").value = detectMediaType(url);
    await ensurePublishedDateOnForm(url);
  } catch {
    if (!silent) alert("제목·날짜를 자동으로 가져오지 못했습니다. 직접 입력해 주세요.");
  } finally {
    if (!silent) { btn.textContent = "정보 가져오기"; btn.removeAttribute("disabled"); }
  }
}

function scheduleAutoFetchMeta() {
  clearTimeout(metaFetchTimer);
  const url = $("#entry-url").value.trim();
  if (!url.startsWith("http") || !needsMetadataFetch()) return;
  metaFetchTimer = setTimeout(async () => {
    if (metaFetchInFlight) return;
    metaFetchInFlight = true;
    try { await handleFetchMeta({ silent: true }); } finally { metaFetchInFlight = false; }
  }, 800);
}

async function resolveEntryMetadata(url, draft) {
  let { title, thumbnail, publishedAt } = draft;
  if (!publishedAt) {
    publishedAt = extractPublishedDateFromUrl(url) || (thumbnail ? extractPublishedDateFromUrl(thumbnail) : undefined);
  }
  if (!publishedAt) {
    try { publishedAt = await fetchPublishedDate(url); } catch { /* ignore */ }
  }
  if (title && thumbnail && publishedAt) return { title, thumbnail, publishedAt };
  try {
    const meta = await fetchMetadata(url);
    if (!title && meta.title) title = meta.title;
    if (!thumbnail && meta.thumbnail) thumbnail = meta.thumbnail;
    if (!publishedAt && meta.publishedAt) publishedAt = meta.publishedAt;
  } catch { /* ignore */ }
  return { title, thumbnail, publishedAt };
}

/* ── Form submit ── */
async function handleFormSubmit(e) {
  e.preventDefault();
  const url = $("#entry-url").value.trim();
  if (!url) return;

  const status = $("#entry-status").value;
  const now = new Date().toISOString();

  const customCat = $("#entry-category-custom").value.trim();
  const categories = [...selectedCategories];
  if (customCat && !categories.includes(customCat)) categories.push(customCat);

  const pendingThumb = form.dataset.pendingThumbnail || undefined;
  const resolved = await resolveEntryMetadata(url, {
    title: $("#entry-title").value.trim() || undefined,
    thumbnail: pendingThumb,
    publishedAt: $("#entry-published").value.trim() || undefined,
  });

  const finalTitle = resolved.title || $("#entry-title").value.trim();
  if (!finalTitle) {
    alert("제목을 자동으로 가져오지 못했습니다. 직접 입력해 주세요.");
    return;
  }

  const data = {
    id: editingId ?? newId(),
    type: $("#entry-type").value,
    url,
    title: finalTitle,
    publishedAt: resolved.publishedAt || null,
    thumbnail: resolved.thumbnail || null,
    summary: $("#entry-summary").value.trim(),
    keywords: parseTags($("#entry-keywords").value),
    categories,
    status,
    watchedAt: status === "watched" ? ($("#entry-watched-at").value || now.slice(0, 10)) : null,
    createdAt: editingId ? (entries.find((x) => x.id === editingId)?.createdAt ?? now) : now,
    updatedAt: now,
  };

  if (editingId) {
    const prev = entries.find((x) => x.id === editingId);
    if (prev?.thumbnail && !data.thumbnail) data.thumbnail = prev.thumbnail;
    entries = entries.map((x) => (x.id === editingId ? data : x));
  } else {
    entries = [data, ...entries];
  }

  delete form.dataset.pendingThumbnail;
  try {
    await saveEntry(data);
  } catch (err) {
    alert(err instanceof Error ? err.message : "저장 실패");
    return;
  }
  updateStorageBadge();
  renderFeed();
  renderArchive();
  closeDialog();
}

async function handleDelete() {
  if (!editingId || !confirm("이 콘텐츠를 삭제할까요?")) return;
  try {
    await deleteEntry(editingId);
  } catch { /* ignore */ }
  entries = entries.filter((e) => e.id !== editingId);
  updateStorageBadge();
  renderFeed();
  renderArchive();
  closeDialog();
}

/* ── Event wiring ── */
function setupTabs() {
  $$(".tabs__item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.getAttribute("data-view");
      if (view === "archive") archiveFocus = null;
      activateView(view === "archive" ? "archive" : "feed");
    });
  });
}

function setupArchiveToolbar() {
  $("#archive-clear-focus")?.addEventListener("click", clearArchiveFocus);
  $("#archive-sort")?.addEventListener("change", (e) => {
    archiveSort = e.target.value;
    if (archiveFocus) renderArchive();
  });
}

function handleTopicClick(e) {
  const el = e.target.closest("[data-topic-label]");
  if (!el) return false;
  const kind = el.getAttribute("data-topic-kind");
  const label = el.getAttribute("data-topic-label");
  if ((kind !== "keyword" && kind !== "category") || !label) return false;
  e.preventDefault();
  e.stopPropagation();
  openArchiveFocus(kind, label);
  return true;
}

function setupFilters() {
  $$(".filter__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.getAttribute("data-filter") ?? "all";
      $$(".filter__btn").forEach((b) => b.classList.toggle("filter__btn--active", b === btn));
      renderFeed();
    });
  });
  $("#search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderFeed();
  });
}

function setupPreferChrome() {
  const box = $("#prefer-chrome");
  if (!box) return;
  box.checked = prefersChromeOpen();
  box.addEventListener("change", () => localStorage.setItem(PREFER_CHROME_KEY, box.checked ? "1" : "0"));
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".content-open-link");
    if (!link?.href || !prefersChromeOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    openContentUrl(link.href);
  }, true);
}

function setupListClicks() {
  feedList.addEventListener("click", (e) => {
    if (handleTopicClick(e)) return;
    if (e.target.closest(".content-open-link")) return;
    const card = e.target.closest(".entry-card");
    if (card?.dataset.id) openDialog(card.dataset.id);
  });
  archiveContent.addEventListener("click", (e) => {
    if (handleTopicClick(e)) return;
    if (e.target.closest(".content-open-link")) return;
    const item = e.target.closest(".archive-item");
    if (item?.dataset.id) openDialog(item.dataset.id);
  });
}

function setupCategoryCustom() {
  $("#entry-category-custom").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (val) {
      selectedCategories.add(val);
      renderCategoryChips();
      e.target.value = "";
    }
  });
}

function setupImportExport() {
  $("#btn-export")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `media-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#btn-import")?.addEventListener("click", () => $("#import-file")?.click());
  $("#import-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("배열 형식이 아닙니다");
      entries = await importEntries(data);
      await persist();
      alert(`${entries.length}개 항목을 가져왔습니다.`);
    } catch {
      alert("가져오기 실패: 올바른 JSON 백업 파일인지 확인하세요.");
    }
    e.target.value = "";
  });
}

function setupDialogEvents() {
  $("#btn-add").addEventListener("click", () => openDialog());
  $("#btn-close-dialog").addEventListener("click", closeDialog);
  $("#btn-cancel").addEventListener("click", closeDialog);
  $("#btn-preview-login")?.addEventListener("click", () => openPreviewLoginWindow($("#entry-url").value.trim()));
  $("#btn-preview-reader")?.addEventListener("click", togglePreviewReaderMode);
  $("#entry-preview-reader")?.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;
    window.setTimeout(() => {
      const sel = window.getSelection()?.toString().trim();
      if (sel) { showTranslatePopover(sel, e.clientX, e.clientY); return; }
      handleReaderTranslate(e);
    }, 10);
  });
  $("#entry-preview-reader")?.addEventListener("dblclick", (e) => handleReaderTranslate(e));
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "t") return;
    const d = $("#entry-dialog");
    if (!d?.open) return;
    e.preventDefault();
    const reader = $("#entry-preview-reader");
    if (reader && !reader.hidden) {
      const sel = window.getSelection()?.toString().trim();
      if (sel) { showTranslatePopover(sel, e.clientX || 200, e.clientY || 120); return; }
    }
    translateFromClipboard();
  });
  $("#btn-fetch-meta").addEventListener("click", handleFetchMeta);
  $("#btn-delete-entry").addEventListener("click", handleDelete);
  $("#entry-status").addEventListener("change", toggleWatchedField);
  $("#entry-url").addEventListener("change", () => {
    const url = $("#entry-url").value.trim();
    if (url) $("#entry-type").value = detectMediaType(url);
    updateContentPreview();
    scheduleAutoFetchMeta();
  });
  $("#entry-url").addEventListener("input", () => { updateContentPreview(); scheduleAutoFetchMeta(); });
  $("#entry-url").addEventListener("paste", () => setTimeout(() => { updateContentPreview(); scheduleAutoFetchMeta(); }, 50));
  form.addEventListener("submit", handleFormSubmit);
  initPreviewResize();
}

function initPreviewResize() {
  const handle = $("#preview-resize-handle");
  const videoWrap = $("#entry-preview-video-wrap");
  if (!handle || !videoWrap) return;

  let startY = 0;
  let startH = 0;
  let dragging = false;

  function onPointerDown(e) {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = videoWrap.offsetHeight;
    handle.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const parent = videoWrap.parentElement;
    const maxH = parent ? parent.offsetHeight * 0.8 : 600;
    const newH = Math.max(160, Math.min(maxH, startH + dy));
    videoWrap.style.height = newH + "px";
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);

  const hHandle = $("#compose-resize-h");
  const preview = $("#entry-preview-panel");
  const formSide = $("#entry-form");
  if (!hHandle || !preview || !formSide) return;

  let hStartX = 0;
  let hStartW = 0;
  let hDragging = false;

  function onHPointerDown(e) {
    e.preventDefault();
    hDragging = true;
    hStartX = e.clientX;
    hStartW = formSide.offsetWidth;
    hHandle.classList.add("dragging");
    hHandle.setPointerCapture(e.pointerId);
  }

  function onHPointerMove(e) {
    if (!hDragging) return;
    const dx = e.clientX - hStartX;
    const newW = Math.max(280, Math.min(800, hStartW - dx));
    formSide.style.flex = "none";
    formSide.style.width = newW + "px";
    formSide.style.maxWidth = newW + "px";
  }

  function onHPointerUp() {
    if (!hDragging) return;
    hDragging = false;
    hHandle.classList.remove("dragging");
  }

  hHandle.addEventListener("pointerdown", onHPointerDown);
  hHandle.addEventListener("pointermove", onHPointerMove);
  hHandle.addEventListener("pointerup", onHPointerUp);
  hHandle.addEventListener("pointercancel", onHPointerUp);
}

function setupAppShell() {
  setupTabs();
  setupArchiveToolbar();
  setupFilters();
  setupListClicks();
  setupCategoryCustom();
  setupImportExport();
  setupPreferChrome();
  setupDialogEvents();
}

/* ── Bootstrap ── */
let appStarted = false;

async function bootstrap() {
  document.documentElement.classList.toggle("is-mobile", isMobileLayout());
  window.matchMedia("(max-width: 768px)").addEventListener("change", () => {
    document.documentElement.classList.toggle("is-mobile", isMobileLayout());
  });

  const loading = $("#loading-screen");
  const setStatus = (msg) => { if (loading) loading.textContent = msg; };

  try {
    setStatus("Firebase 연결 중…");
    const app = initializeApp(firebaseConfig);

    setStatus("로그인 확인 중…");
    const user = await initAuth(app);

    setStatus("데이터베이스 연결 중…");
    initFirestore(app);

    setStatus("화면 준비 중…");
    updateAuthUI(user);

    $("#btn-google-login")?.addEventListener("click", async () => {
      try {
        const u = await signInWithGoogle();
        updateAuthUI(u);
        if (!appStarted) await startApp();
      } catch (err) {
        if (err.code !== "auth/popup-closed-by-user") {
          alert("로그인에 실패했습니다. 다시 시도해 주세요.");
        }
      }
    });

    if (user) await startApp();
  } catch (err) {
    console.error("Bootstrap error:", err);
    const loading = $("#loading-screen");
    if (loading) loading.textContent = "앱 초기화에 실패했습니다. 페이지를 새로고침해 주세요.";
  }
}

async function startApp() {
  if (appStarted) return;
  appStarted = true;
  setupAppShell();

  const syncBtn = $("#btn-sync");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      try {
        entries = await loadEntries();
        updateStorageBadge();
        renderFeed();
        renderArchive();
        alert(`새로고침 완료: ${entries.length}개`);
      } catch (err) {
        console.error("Sync error:", err);
        alert("데이터를 불러오지 못했습니다.");
      }
    });
  }

  $("#btn-logout")?.addEventListener("click", async () => {
    await signOut();
    updateAuthUI(null);
    entries = [];
    appStarted = false;
    renderFeed();
    renderArchive();
  });

  try {
    entries = await loadEntries();
  } catch (err) {
    console.error("Load error:", err);
    entries = [];
  }
  updateStorageBadge();
  renderFeed();
  renderArchive();

  if (entries.length === 0) {
    setFeedEmptyVisible(true);
    const msg = $("#feed-empty-msg");
    if (msg) msg.textContent = "아직 기록된 콘텐츠가 없습니다.";
    const hint = document.querySelector(".empty-state__hint");
    if (hint) hint.innerHTML = '<strong>+ 추가</strong> 버튼을 눌러 콘텐츠를 기록해 보세요.';
  }
}

onAuthChange((user) => {
  updateAuthUI(user);
});

bootstrap();
