/**
 * Netlify Function: YouTube 영상 정보 조회 (innertube API)
 * GET /.netlify/functions/youtube-date?v=VIDEO_ID
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20250520.01.00",
  hl: "ko",
  gl: "KR",
};

export default async (req) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("v");
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: "invalid video id" }), { status: 400, headers });
  }

  try {
    const [playerRes, nextRes] = await Promise.all([
      innertube("player", { videoId }),
      innertube("next", { videoId }),
    ]);

    const playerData = playerRes.ok ? await playerRes.json() : {};
    const nextData = nextRes.ok ? await nextRes.json() : {};

    const details = playerData?.videoDetails ?? {};
    const micro = playerData?.microformat?.playerMicroformatRenderer ?? {};

    const uploadDate = micro.uploadDate || micro.publishDate || null;
    const isoDate = uploadDate ? uploadDate.replace(/T.*/, "").slice(0, 10) : null;

    const description =
      details.shortDescription ||
      extractDescriptionFromNext(nextData) ||
      micro.description?.simpleText ||
      null;

    const result = {
      ok: true,
      publishedAt: isoDate,
      title: details.title || micro.title?.simpleText || null,
      channel: details.author || micro.ownerChannelName || null,
      viewCount: details.viewCount || null,
      description,
      thumbnail: micro.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
    };

    const commentToken = findCommentsContinuation(nextData);
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

    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};

async function innertube(endpoint, extra) {
  return fetch(`https://www.youtube.com/youtubei/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ context: { client: CLIENT }, ...extra }),
  });
}

function extractDescriptionFromNext(data) {
  try {
    const panels = data?.engagementPanels ?? [];
    for (const panel of panels) {
      const content = panel?.engagementPanelSectionListRenderer?.content;
      const items =
        content?.structuredDescriptionContentRenderer?.items ?? [];
      for (const item of items) {
        const body = item?.expandableVideoDescriptionBodyRenderer;
        if (body?.descriptionBodyText?.runs) {
          return body.descriptionBodyText.runs.map((r) => r.text || "").join("");
        }
      }
    }

    const results = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
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

function findCommentsContinuation(data) {
  try {
    const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const c of contents) {
      const section = c?.itemSectionRenderer;
      if (!section) continue;

      const sectionId = section?.sectionIdentifier;
      const targetId = section?.targetId;
      if (sectionId === "comment-item-section" || targetId === "comments-section" ||
          targetId === "comment-item-section") {
        for (const item of section.contents ?? []) {
          const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (token) return token;
        }
      }
    }

    for (const c of contents) {
      const section = c?.itemSectionRenderer;
      if (!section) continue;
      for (const item of section.contents ?? []) {
        const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (token) return token;
      }
    }

    const json = JSON.stringify(data);
    const re = /"token"\s*:\s*"(Eg[A-Za-z0-9_-]{30,})"/g;
    let m;
    while ((m = re.exec(json)) !== null) {
      if (m[1].includes("comment") || m[1].startsWith("Eg0S")) return m[1];
    }
    re.lastIndex = 0;
    while ((m = re.exec(json)) !== null) {
      return m[1];
    }
  } catch { /* ignore */ }
  return null;
}

function extractCommentsFromResponse(data) {
  const items = [];

  const endpoints = data?.onResponseReceivedEndpoints ?? [];
  for (const ep of endpoints) {
    const ci =
      ep?.reloadContinuationItemsCommand?.continuationItems ??
      ep?.appendContinuationItemsAction?.continuationItems ?? [];
    items.push(...ci);
  }

  const frameworkUpdates = data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
  const fwComments = [];
  for (const mutation of frameworkUpdates) {
    const payload = mutation?.payload?.commentEntityPayload;
    if (payload) {
      const author = payload.author?.displayName || "";
      const text = payload.properties?.content?.content || "";
      const likes = payload.toolbar?.likeCountLiked || payload.toolbar?.likeCountNotliked || "";
      const time = payload.properties?.publishedTime || "";
      if (text.trim()) fwComments.push({ author, text, likes, time });
    }
  }
  if (fwComments.length > 0) return fwComments.slice(0, 15);

  return extractCommentsFromItems(items);
}

function extractCommentsFromItems(items) {
  const comments = [];
  for (const item of items) {
    const thread = item?.commentThreadRenderer;
    const c = thread?.comment?.commentRenderer ?? item?.commentRenderer;
    if (!c) continue;

    const author = c.authorText?.simpleText || "";
    const text = (c.contentText?.runs ?? []).map((r) => r.text || "").join("");
    const likes = c.voteCount?.simpleText || "";
    const time = (c.publishedTimeText?.runs ?? []).map((r) => r.text || "").join("") ||
      c.publishedTimeText?.simpleText || "";

    if (text.trim()) {
      comments.push({ author, text, likes, time });
    }
    if (comments.length >= 15) break;
  }
  return comments;
}

export const config = { path: "/.netlify/functions/youtube-date" };
