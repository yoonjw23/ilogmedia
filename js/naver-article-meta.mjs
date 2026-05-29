/**
 * 네이버 뉴스 기사 헤더 메타 추출 (브라우저 + Netlify Function 공용)
 */

/** 네이버 뉴스 언론사 코드(oid) → 이름 */
const PRESS_BY_OID = {
  "001": "연합뉴스",
  "002": "프레시안",
  "003": "뉴시스",
  "005": "국민일보",
  "008": "머니투데이",
  "009": "매일경제",
  "011": "서울경제",
  "014": "파이낸셜뉴스",
  "015": "한국경제",
  "016": "헤럴드경제",
  "018": "이데일리",
  "020": "동아일보",
  "021": "문화일보",
  "022": "세계일보",
  "023": "조선일보",
  "024": "매일신문",
  "025": "중앙일보",
  "028": "한겨레",
  "029": "디지털타임스",
  "030": "전자신문",
  "031": "아이뉴스24",
  "032": "경향신문",
  "036": "서울신문",
  "037": "KBS",
  "038": "MBC",
  "044": "코리아헤럴드",
  "052": "YTN",
  "055": "SBS",
  "056": "KBS",
  "057": "MBN",
  "079": "노컷뉴스",
  "081": "오마이뉴스",
  "092": "지디넷코리아",
  "214": "MBC",
  "277": "아시아경제",
  "293": "블로터",
  "374": "SBS Biz",
  "421": "뉴스1",
  "422": "연합뉴스TV",
  "437": "이투데이",
  "449": "채널A",
  "586": "시사저널",
  "629": "비즈워치",
  "656": "대전일보",
  "658": "국제신문",
  "660": "kbc광주방송",
  "662": "농민신문",
  "666": "경기일보",
  "667": "인천일보",
  "668": "부산일보",
  "669": "강원도민일보",
  "670": "대구일보",
  "671": "광주일보",
  "673": "충북일보",
  "674": "경남신문",
  "675": "전북일보",
  "676": "제민일보",
  "677": "강원일보",
  "678": "경북매일",
  "679": "전남일보",
  "680": "제주일보",
  "681": "충청일보",
  "682": "경인일보",
  "683": "충청타임즈",
  "684": "경남도민일보",
  "685": "전라일보",
  "686": "경북도민일보",
  "687": "강원도민일보",
  "688": "충북도민일보",
  "689": "전남도민일보",
  "690": "제주도민일보",
};

/**
 * @param {string} html
 * @param {string} [baseUrl]
 */
export function extractNaverArticleMeta(html, baseUrl = "") {
  const pressBlock = extractClassBlock(html, "media_end_head_top");
  const pressLogo = resolveUrl(extractPressLogo(html, pressBlock), baseUrl);
  const byline = extractFromDicAreaByline(html);

  let press =
    extractPressName(html, pressBlock) ||
    cleanPressName(metaContent(html, "og:article:author")) ||
    cleanPressName(metaContent(html, "article:author")) ||
    extractJsonLdPublisher(html) ||
    byline.press ||
    extractPressFromOid(baseUrl) ||
    null;

  let journalists = extractJournalists(html, baseUrl);
  if (journalists.length === 0 && byline.journalists.length > 0) {
    journalists = byline.journalists;
  }

  const jsonAuthors = extractJsonLdAuthors(html);
  if (journalists.length === 0 && jsonAuthors.length > 0) {
    journalists = jsonAuthors.map((name) => ({ name, role: "기자", photo: null }));
  }

  const author =
    journalists.length > 0
      ? journalists.map((j) => (j.role ? `${j.name} ${j.role}` : j.name)).join(", ")
      : null;

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
  const title = block.match(/<img[^>]+title=["']([^"']+)["']/i);
  if (title?.[1]) return decodeEntities(title[1].trim());
  const aria = block.match(/aria-label=["']([^"']+)["']/i);
  if (aria?.[1]) return decodeEntities(aria[1].trim());
  const text = stripTags(block).replace(/\s+/g, " ").trim();
  if (text.length >= 2 && text.length <= 20) return text;
  return null;
}

export function extractPressFromOid(baseUrl) {
  if (!baseUrl) return null;
  const m = baseUrl.match(/\/article\/(\d{3})\//);
  if (!m) return null;
  return PRESS_BY_OID[m[1]] || null;
}

/** 서버가 내려준 본문 HTML만 있을 때 재추출 */
export function extractMetaFromArticleBody(bodyHtml) {
  return extractFromDicAreaByline(`<article id="dic_area">${bodyHtml}</article>`);
}

/** 본문 첫 줄 (도쿄=연합뉴스) 이도연 특파원 = 패턴 */
function extractFromDicAreaByline(html) {
  const inner = extractDicArea(html);
  if (!inner) return { press: null, journalists: [] };

  const text = normalizeSpaces(stripTags(inner.slice(0, 1200)))
    .replace(/\u00a0/g, " ")
    .replace(/＝/g, "=")
    .replace(/（/g, "(")
    .replace(/）/g, ")");

  const wireRe =
    /\([^)=]+=\s*([^)]+?)\)\s*([가-힣·]{2,10})\s*(특파원|기자|통신원|객원기자|인턴기자)\s*=/;
  const wireM = text.match(wireRe);
  if (wireM) {
    return {
      press: wireM[1].trim(),
      journalists: [{ name: wireM[2].trim(), role: wireM[3], photo: null }],
    };
  }

  const plainRe = /([가-힣]{2,12})\s+([가-힣]{2,6})\s*(특파원|기자|통신원)\s*=/;
  const plainM = text.match(plainRe);
  if (plainM) {
    return {
      press: plainM[1].trim(),
      journalists: [{ name: plainM[2].trim(), role: plainM[3], photo: null }],
    };
  }

  return { press: null, journalists: [] };
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

  const headJournalist = extractClassBlock(html, "media_end_head_journalist");
  if (headJournalist) {
    const headText = normalizeSpaces(stripTags(headJournalist));
    const roleM = headText.match(/([가-힣·]{2,10})\s*(특파원|기자|통신원|객원기자)/);
    if (roleM) {
      cards.push({ name: roleM[1], role: roleM[2], photo: resolveUrl(extractImgSrc(headJournalist), baseUrl) });
    }
  }

  const legacyRe = /class=["'][^"']*media_journalist[^"']*["'][^>]*>([^<]+)</gi;
  while ((m = legacyRe.exec(html)) !== null) {
    const raw = decodeEntities(m[1].trim());
    const roleM = raw.match(/^([가-힣·]{2,10})\s*(특파원|기자|통신원)$/);
    if (roleM) {
      cards.push({ name: roleM[1], role: roleM[2], photo: null });
      continue;
    }
    const name = raw.replace(/\s*(기자|특파원)\s*$/, "");
    if (name && name.length <= 12) {
      cards.push({ name, role: raw.includes("특파원") ? "특파원" : "기자", photo: null });
    }
  }

  if (cards.length === 0) {
    const nameM = html.match(
      /class=["'][^"']*media_end_head_journalist[^"']*["'][^>]*>[\s\S]{0,500}?([가-힣·]{2,10})\s*(특파원|기자)/i
    );
    if (nameM?.[1]) {
      cards.push({ name: nameM[1], role: nameM[2] || "기자", photo: null });
    }
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
  const singleRe = /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/gi;
  while ((m = singleRe.exec(html)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (name && name.length <= 12 && !names.includes(name)) names.push(name);
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
