/**
 * Netlify Function: YouTube 영상 정보 조회
 * GET /.netlify/functions/youtube-date?v=VIDEO_ID
 *
 * 1) player API → 업로드일, 제목, 채널, 조회수
 * 2) watch 페이지 HTML → ytInitialData → 설명(한국어), 댓글 continuation 토큰
 * 3) next API (continuation) → 댓글 (ViewModel + mutations 구조 대응)
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20250520.01.00",
  hl: "ko",
  gl: "KR",
};
const HEADERS_OUT = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600",
};

export default async (req) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("v");

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: "invalid video id" }), {
      status: 400,
      headers: HEADERS_OUT,
    });
  }

  try {
    const [playerRes, htmlRes] = await Promise.all([
      innertube("player", { videoId }),
      fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko&gl=KR`, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
      }),
    ]);

    const playerData = playerRes.ok ? await playerRes.json() : {};
    const html = htmlRes.ok ? await htmlRes.text() : "";

    const details = playerData?.videoDetails ?? {};
    const micro = playerData?.microformat?.playerMicroformatRenderer ?? {};

    const uploadDate = micro.uploadDate || micro.publishDate || null;
    const isoDate = uploadDate ? uploadDate.replace(/T.*/, "").slice(0, 10) : null;

    const initialData = parseInlineJson(html, "ytInitialData");

    const descFromPage = extractDescriptionFromInitialData(initialData);
    const description = descFromPage || details.shortDescription || micro.description?.simpleText || null;

    const result = {
      ok: true,
      publishedAt: isoDate,
      title: details.title || micro.title?.simpleText || null,
      channel: details.author || micro.ownerChannelName || null,
      viewCount: details.viewCount || null,
      description,
      thumbnail: micro.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
    };

    const commentToken = getCommentsContinuationToken(initialData);
    if (commentToken) {
      try {
        const commentsRes = await innertube("next", { continuation: commentToken });
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          const c = extractCommentsFromResponse(commentsData);
          if (c.length > 0) result.comments = c;
        }
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify(result), { headers: HEADERS_OUT });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: HEADERS_OUT,
    });
  }
};

async function innertube(endpoint, extra) {
  return fetch(`https://www.youtube.com/youtubei/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ context: { client: CLIENT }, ...extra }),
  });
}

function parseInlineJson(html, varName) {
  if (!html) return null;
  for (const prefix of [`var ${varName} = `, `${varName} = `]) {
    let idx = html.indexOf(prefix);
    if (idx === -1) continue;
    idx += prefix.length;
    let depth = 0;
    for (let i = idx; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(idx, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function extractDescriptionFromInitialData(data) {
  if (!data) return null;
  try {
    const panels = data?.engagementPanels ?? [];
    for (const panel of panels) {
      const content = panel?.engagementPanelSectionListRenderer?.content;
      const items = content?.structuredDescriptionContentRenderer?.items ?? [];
      for (const item of items) {
        const body = item?.expandableVideoDescriptionBodyRenderer;
        if (body?.descriptionBodyText?.runs) {
          return body.descriptionBodyText.runs.map((r) => r.text || "").join("");
        }
      }
    }

    const results =
      data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const c of results) {
      const secondary = c?.videoSecondaryInfoRenderer;
      if (secondary?.attributedDescription?.content) {
        return secondary.attributedDescription.content;
      }
      if (secondary?.description?.runs) {
        return secondary.description.runs.map((r) => r.text || "").join("");
      }
    }
  } catch { /* ignore */ }
  return null;
}

function getCommentsContinuationToken(data) {
  if (!data) return null;
  try {
    const contents =
      data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const content of contents) {
      const inner = content?.itemSectionRenderer?.contents ?? [];
      for (const ic of inner) {
        const token =
          ic?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (token) return token;
      }
      const continuations = content?.itemSectionRenderer?.continuations;
      if (continuations?.[0]) {
        return (
          continuations[0]?.nextContinuationData?.continuation ||
          continuations[0]?.reloadContinuationData?.continuation
        );
      }
    }
  } catch { /* ignore */ }
  return null;
}

function extractCommentsFromResponse(data) {
  const mutations = data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  const commentMap = buildCommentMap(mutations);

  const items = [];
  const endpoints = data?.onResponseReceivedEndpoints ?? [];
  for (const ep of endpoints) {
    const ci =
      ep?.reloadContinuationItemsCommand?.continuationItems ??
      ep?.appendContinuationItemsAction?.continuationItems ?? [];
    items.push(...ci);
  }

  if (commentMap.size > 0) {
    const comments = [];
    for (const item of items) {
      const thread = item?.commentThreadRenderer;
      const vm =
        thread?.commentViewModel?.commentViewModel ??
        thread?.comment?.commentViewModel?.commentViewModel;
      if (vm?.commentKey) {
        const c = commentMap.get(vm.commentKey);
        if (c && c.text.trim()) {
          comments.push(c);
          if (comments.length >= 15) break;
        }
        continue;
      }

      const cr = thread?.comment?.commentRenderer ?? item?.commentRenderer;
      if (cr) {
        const c = parseCommentRenderer(cr);
        if (c && c.text.trim()) {
          comments.push(c);
          if (comments.length >= 15) break;
        }
      }
    }
    if (comments.length > 0) return comments;
  }

  const legacyComments = [];
  for (const item of items) {
    const thread = item?.commentThreadRenderer;
    const cr = thread?.comment?.commentRenderer ?? item?.commentRenderer;
    if (!cr) continue;
    const c = parseCommentRenderer(cr);
    if (c && c.text.trim()) {
      legacyComments.push(c);
      if (legacyComments.length >= 15) break;
    }
  }
  return legacyComments;
}

function buildCommentMap(mutations) {
  const map = new Map();
  for (const m of mutations) {
    const p = m?.payload?.commentEntityPayload;
    if (!p) continue;
    map.set(m.entityKey, {
      author: p.author?.displayName || "",
      text: p.properties?.content?.content || "",
      likes: p.toolbar?.likeCountNotliked || p.toolbar?.likeCountLiked || "",
      time: p.properties?.publishedTime || "",
    });
  }
  return map;
}

function parseCommentRenderer(cr) {
  if (!cr) return null;
  return {
    author: cr.authorText?.simpleText || "",
    text: (cr.contentText?.runs ?? []).map((r) => r.text || "").join(""),
    likes: cr.voteCount?.simpleText || "",
    time:
      (cr.publishedTimeText?.runs ?? []).map((r) => r.text || "").join("") ||
      cr.publishedTimeText?.simpleText ||
      "",
  };
}

export const config = { path: "/.netlify/functions/youtube-date" };
