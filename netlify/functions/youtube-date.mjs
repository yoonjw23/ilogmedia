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

    const comments = extractComments(nextData);

    const result = {
      ok: true,
      publishedAt: isoDate,
      title: details.title || micro.title?.simpleText || null,
      channel: details.author || micro.ownerChannelName || null,
      viewCount: details.viewCount || null,
      description,
      thumbnail: micro.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
    };

    if (comments.length > 0) {
      result.comments = comments;
    } else {
      const token = extractCommentsContinuation(nextData);
      if (token) {
        try {
          const commentsRes = await innertube("next", { continuation: token });
          if (commentsRes.ok) {
            const commentsData = await commentsRes.json();
            const c = extractCommentsFromContinuation(commentsData);
            if (c.length > 0) result.comments = c;
          }
        } catch { /* ignore */ }
      }
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

function extractCommentsContinuation(data) {
  try {
    const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const c of contents) {
      const section = c?.itemSectionRenderer;
      if (section) {
        for (const item of section.contents ?? []) {
          const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (token) return token;
        }
      }
    }

    const json = JSON.stringify(data);
    const tokens = [];
    const re = /"token"\s*:\s*"(Eg[A-Za-z0-9_-]{20,})"/g;
    let m;
    while ((m = re.exec(json)) !== null) tokens.push(m[1]);
    for (const t of tokens) {
      if (t.startsWith("Eg")) return t;
    }
  } catch { /* ignore */ }
  return null;
}

function extractComments(data) {
  return extractCommentsFromItems(
    data?.onResponseReceivedEndpoints
      ?.flatMap((e) =>
        e?.reloadContinuationItemsCommand?.continuationItems ??
        e?.appendContinuationItemsAction?.continuationItems ?? []
      ) ?? []
  );
}

function extractCommentsFromContinuation(data) {
  return extractCommentsFromItems(
    data?.onResponseReceivedEndpoints
      ?.flatMap((e) =>
        e?.reloadContinuationItemsCommand?.continuationItems ??
        e?.appendContinuationItemsAction?.continuationItems ?? []
      ) ?? []
  );
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
