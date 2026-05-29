/**
 * 네이버 뉴스 기사 헤더 메타 추출 (브라우저 + Netlify Function 공용)
 */

/**
 * @param {string} html
 * @param {string} [baseUrl]
 */
export function extractNaverArticleMeta(html, baseUrl = "") {
  const pressBlock = extractClassBlock(html, "media_end_head_top");
  const pressLogo = resolveUrl(extractPressLogo(html, pressBlock), baseUrl);
  const press =
    extractPressName(html, pressBlock) ||
    cleanPressName(metaContent(html, "og:article:author")) ||
    extractJsonLdPublisher(html) ||
    null;

  const journalists = extractJournalists(html, baseUrl);
  const author =
    journalists.length > 0
      ? journalists.map((j) => (j.role ? `${j.name} ${j.role}` : j.name)).join(", ")
      : extractJsonLdAuthors(html).join(", ") || null;

  const publishedAt =
    metaContent(html, "article:published_time") ||
    metaContent(html, "og:article:published_time") ||
    extractJsonLdDate(html, "datePublished") ||
    null;

  const modifiedAt = extractJsonLdDate(html, "dateModified") || null;

  const dateBlock = extractClassBlock(html, "media_end_head_info_datestamp");
  const { publishedLabel, modifiedLabel } = extractDateLabels(html, dateBlock);

  const subtitle =
    extractByClassText(html, "media_end_head_desc") ||
    extractByClassText(html, "media_end_summary") ||
    extractSubtitleFromBody(html) ||
    null;

  return {
    press,
    pressLogo,
    journalists,
    author,
    publishedAt: publishedAt ? publishedAt.replace(/T.*/, "").slice(0, 10) : null,
    modifiedAt: modifiedAt ? modifiedAt.replace(/T.*/, "").slice(0, 10) : null,
    publishedLabel,
    modifiedLabel,
    subtitle,
  };
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function cleanPressName(raw) {
  if (!raw) return null;
  const name = raw
    .replace(/\s*\|\s*네이버\s*$/i, "")
    .replace(/\s*-\s*네이버\s*뉴스\s*$/i, "")
    .trim();
  return name || null;
}

function extractPressName(html, pressBlock) {
  const block = pressBlock || extractClassBlock(html, "media_end_head_top");
  if (!block) return null;
  const alt = block.match(/<img[^>]+alt=["']([^"']+)["']/i);
  if (alt?.[1]) return decodeEntities(alt[1].trim());
  const text = stripTags(block).replace(/\s+/g, " ").trim();
  if (text.length >= 2 && text.length <= 20) return text;
  return null;
}

function extractPressLogo(html, pressBlock) {
  const block = pressBlock || extractClassBlock(html, "media_end_head_top");
  if (!block) return null;
  const img = block.match(/<img\b[^>]*>/i);
  if (!img) return null;
  return (
    pickAttr(img[0], "src") ||
    pickAttr(img[0], "data-src") ||
    pickAttr(img[0], "data-lazy-src") ||
    null
  );
}

function extractJournalists(html, baseUrl = "") {
  const cards = [];
  const linkRe =
    /<a[^>]*class=["'][^"']*media_journalistcard_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const block = m[1];
    const name =
      extractNamedInBlock(block, "media_journalistcard_name") ||
      extractNamedInBlock(block, "media_journalist_name");
    if (!name) continue;
    const role =
      extractNamedInBlock(block, "media_journalistcard_role") ||
      (block.includes("기자") ? "기자" : "");
    const photo = resolveUrl(extractImgSrc(block), baseUrl);
    cards.push({ name, role: role || "기자", photo });
  }

  if (cards.length > 0) return dedupeJournalists(cards);

  const legacyRe = /class=["'][^"']*media_journalist[^"']*["'][^>]*>([^<]+)</gi;
  while ((m = legacyRe.exec(html)) !== null) {
    const name = decodeEntities(m[1].trim()).replace(/\s*기자\s*$/, "");
    if (name && name.length <= 12) {
      cards.push({ name, role: "기자", photo: null });
    }
  }

  const byline = html.match(
    /class=["'][^"']*media_end_head_journalist[^"']*["'][^>]*>[\s\S]*?([가-힣]{2,5})\s*기자/gi
  );
  if (cards.length === 0 && byline) {
    const nameM = html.match(
      /class=["'][^"']*media_end_head_journalist[^"']*["'][^>]*>[\s\S]{0,400}?([가-힣]{2,5})\s*기자/i
    );
    if (nameM?.[1]) cards.push({ name: nameM[1], role: "기자", photo: null });
  }

  return dedupeJournalists(cards);
}

function dedupeJournalists(list) {
  const out = [];
  for (const j of list) {
    if (!j.name) continue;
    if (!out.some((x) => x.name === j.name)) out.push(j);
  }
  return out;
}

function extractNamedInBlock(block, className) {
  const re = new RegExp(
    `class=["'][^"']*${className}[^"']*["'][^>]*>([^<]+)<`,
    "i"
  );
  const m = block.match(re);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function extractImgSrc(block) {
  const img = block.match(/<img\b[^>]*>/i);
  if (!img) return null;
  return (
    pickAttr(img[0], "src") ||
    pickAttr(img[0], "data-src") ||
    pickAttr(img[0], "data-lazy-src") ||
    null
  );
}

function extractDateLabels(html, dateBlock) {
  const block = dateBlock || extractClassBlock(html, "media_end_head_info_datestamp");
  const text = block ? normalizeSpaces(stripTags(block)) : normalizeSpaces(stripTags(html));

  const inputRe =
    /입력\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*((?:오전|오후)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2})?/i;
  const modRe =
    /수정\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*((?:오전|오후)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2})?/i;

  let publishedLabel = null;
  let modifiedLabel = null;

  const inputM = text.match(inputRe);
  if (inputM) {
    publishedLabel = formatNaverDateLabel("입력", inputM);
  }

  const modM = text.match(modRe);
  if (modM) {
    modifiedLabel = formatNaverDateLabel("수정", modM);
  }

  if (!publishedLabel) {
    const iso = extractJsonLdDate(html, "datePublished");
    if (iso) publishedLabel = isoToNaverLabel("입력", iso);
  }

  return { publishedLabel, modifiedLabel };
}

function formatNaverDateLabel(prefix, m) {
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  const time = m[4] ? ` ${m[4].trim()}` : "";
  return `${prefix} ${y}.${mo}.${d}.${time}`;
}

function isoToNaverLabel(prefix, iso) {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const h = dt.getHours();
    const min = String(dt.getMinutes()).padStart(2, "0");
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h % 12 || 12;
    return `${prefix} ${y}.${mo}.${d}. ${ampm} ${h12}:${min}`;
  } catch {
    return null;
  }
}

function extractJsonLdDate(html, field) {
  const re = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, "i");
  const m = html.match(re);
  return m?.[1] || null;
}

function extractJsonLdPublisher(html) {
  const m = html.match(/"publisher"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function extractJsonLdAuthors(html) {
  const names = [];
  const re = /"@type"\s*:\s*"Person"[^}]*"name"\s*:\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function extractByClassText(html, className) {
  const block = extractClassBlock(html, className);
  if (!block) return null;
  const text = normalizeSpaces(stripTags(block));
  return text.length >= 4 && text.length <= 120 ? text : null;
}

function extractSubtitleFromBody(html) {
  const inner = extractDicArea(html);
  if (!inner) return null;
  const strong = inner.match(/<strong[^>]*>([^<]{4,100})<\/strong>/i);
  if (strong?.[1]) {
    const t = decodeEntities(strong[1].trim());
    if (!/^사진|연합|뉴스|기자/.test(t)) return t;
  }
  return null;
}

function extractDicArea(html) {
  const openRe = /<(article|div)[^>]*\bid=["']dic_area["'][^>]*>/i;
  const m = html.match(openRe);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const openEnd = html.indexOf(m[0]) + m[0].length;
  let depth = 1;
  let i = openEnd;
  const reOpen = new RegExp(`<${tag}[\\s>]`, "gi");
  const reClose = new RegExp(`</${tag}>`, "gi");
  while (i < html.length && depth > 0) {
    reOpen.lastIndex = i;
    reClose.lastIndex = i;
    const o = reOpen.exec(html);
    const c = reClose.exec(html);
    if (!c && !o) break;
    if (o && (!c || o.index < c.index)) {
      depth++;
      i = o.index + o[0].length;
    } else if (c) {
      depth--;
      if (depth === 0) return html.slice(openEnd, c.index);
      i = c.index + c[0].length;
    }
  }
  return null;
}

function extractClassBlock(html, className) {
  const openRe = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`,
    "i"
  );
  const m = html.match(openRe);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const openEnd = html.indexOf(m[0]) + m[0].length;
  let depth = 1;
  let i = openEnd;
  const reOpen = new RegExp(`<${tag}[\\s>]`, "gi");
  const reClose = new RegExp(`</${tag}>`, "gi");
  while (i < html.length && depth > 0) {
    reOpen.lastIndex = i;
    reClose.lastIndex = i;
    const o = reOpen.exec(html);
    const c = reClose.exec(html);
    if (!c && !o) break;
    if (o && (!c || o.index < c.index)) {
      depth++;
      i = o.index + o[0].length;
    } else if (c) {
      depth--;
      if (depth === 0) return html.slice(openEnd, c.index);
      i = c.index + c[0].length;
    }
  }
  return null;
}

function pickAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return m?.[1] || null;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ");
}

function normalizeSpaces(s) {
  return s.replace(/\s+/g, " ").trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function resolveUrl(src, baseUrl) {
  if (!src || !baseUrl) return src || null;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}
