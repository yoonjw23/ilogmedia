/**
 * Netlify Function: 네이버 등 기사 본문 HTML 조회
 * GET /.netlify/functions/article-view?url=ENCODED_URL
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

export default async (req) => {
  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");

  if (!target || !target.startsWith("http")) {
    return json({ ok: false, error: "invalid url" }, 400);
  }

  try {
    const host = new URL(target).hostname.replace(/^www\./, "");
    if (!host.includes("naver")) {
      return json({ ok: false, error: "unsupported host" }, 400);
    }

    const res = await fetch(target, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return json({ ok: false, error: `fetch ${res.status}` }, 502);
    }

    const html = await res.text();
    const inner = extractNaverArticleInnerHtml(html);
    if (!inner) {
      return json({ ok: false, error: "article body not found" }, 404);
    }

    const bodyHtml = sanitizeArticleHtml(inner, target);
    if (!bodyHtml || bodyHtml.length < 40) {
      return json({ ok: false, error: "empty body" }, 404);
    }

    const meta = extractArticleMeta(html);

    return json({
      ok: true,
      title: extractTitle(html),
      bodyHtml,
      finalUrl: res.url || target,
      ...meta,
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function extractTitle(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
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

function extractArticleMeta(html) {
  const publishedAt =
    metaContent(html, "article:published_time") ||
    metaContent(html, "og:article:published_time") ||
    extractIsoFromJsonLd(html) ||
    null;

  const publishedLabel =
    extractByClass(html, "media_end_head_info_datestamp") ||
    extractInputDateLabel(html) ||
    null;

  const press =
    metaContent(html, "og:article:author") ||
    extractPressName(html) ||
    null;

  const journalists = extractJournalists(html);
  const author = journalists.length > 0 ? journalists.join(", ") : null;

  return {
    publishedAt: publishedAt ? publishedAt.replace(/T.*/, "").slice(0, 10) : null,
    publishedLabel,
    press,
    author,
  };
}

function extractIsoFromJsonLd(html) {
  const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  return m?.[1] || null;
}

function extractByClass(html, className) {
  const re = new RegExp(
    `class=["'][^"']*${className}[^"']*["'][^>]*>([^<]+)<`,
    "i"
  );
  const m = html.match(re);
  return m?.[1] ? decodeEntities(m[1].trim()) : null;
}

function extractInputDateLabel(html) {
  const m = html.match(/입력\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\.\s*[^<]{0,40})?/i);
  if (!m) return null;
  const tail = html.match(
    new RegExp(
      `입력\\s*${m[1]}\\.\\s*${m[2]}\\.\\s*${m[3]}(?:\\.\\s*([^<]+))?`,
      "i"
    )
  );
  if (tail?.[1]) {
    return `입력 ${m[1]}. ${m[2]}. ${m[3]}. ${decodeEntities(tail[1].trim())}`;
  }
  return `입력 ${m[1]}. ${m[2]}. ${m[3]}.`;
}

function extractPressName(html) {
  const alt = html.match(/class=["'][^"']*media_end_head_top[^"']*["'][^>]*>[\s\S]*?alt=["']([^"']+)["']/i);
  if (alt?.[1]) return decodeEntities(alt[1].trim());
  const link = html.match(/class=["'][^"']*media_end_head_top[^"']*["'][^>]*>[\s\S]*?>([^<]{2,30})</i);
  return link?.[1] ? decodeEntities(link[1].trim()) : null;
}

function extractJournalists(html) {
  const names = [];
  const re = /class=["'][^"']*media_journalist[^"']*["'][^>]*>([^<]+)</gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = decodeEntities(m[1].trim());
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function extractNaverArticleInnerHtml(html) {
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
      if (depth === 0) return html.slice(openEnd, c.index).trim();
      i = c.index + c[0].length;
    }
  }
  return null;
}

function pickAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return m?.[1];
}

function resolveImgSrc(tag, baseUrl) {
  const candidates = [
    pickAttr(tag, "data-src"),
    pickAttr(tag, "data-original-src"),
    pickAttr(tag, "data-lazy-src"),
    pickAttr(tag, "src"),
  ].filter(Boolean);
  const src =
    candidates.find((s) => !s.startsWith("data:") && !/blank\.(gif|png)/i.test(s)) ||
    candidates[0];
  if (!src) return null;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

function sanitizeArticleHtml(dirty, baseUrl) {
  let out = dirty
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on\w+="[^"]*"/gi, "");

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const abs = resolveImgSrc(tag, baseUrl);
    if (!abs) return "";
    const alt = pickAttr(tag, "alt") || "";
    return `<img src="${abs}" alt="${alt.replace(/"/g, "&quot;")}" loading="lazy" referrerpolicy="no-referrer" />`;
  });

  out = out.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
  return out.trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export const config = { path: "/.netlify/functions/article-view" };
