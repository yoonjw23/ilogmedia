/**
 * Netlify Function: YouTube 영상 정보 조회 (innertube API)
 * GET /.netlify/functions/youtube-date?v=VIDEO_ID
 */
export default async (req) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("v");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: "invalid video id" }), { status: 400, headers });
  }

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const playerBody = JSON.stringify({
    context: { client: { clientName: "WEB", clientVersion: "2.20240101.01.00" } },
    videoId,
  });

  const nextBody = JSON.stringify({
    context: { client: { clientName: "WEB", clientVersion: "2.20240101.01.00" } },
    videoId,
    params: "8AEB",
  });

  try {
    const [playerRes, nextRes] = await Promise.all([
      fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: playerBody,
      }),
      fetch("https://www.youtube.com/youtubei/v1/next", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: nextBody,
      }).catch(() => null),
    ]);

    if (!playerRes.ok) {
      return new Response(
        JSON.stringify({ error: "innertube error", status: playerRes.status }),
        { status: 502, headers }
      );
    }

    const playerData = await playerRes.json();
    const micro = playerData?.microformat?.playerMicroformatRenderer ?? {};
    const details = playerData?.videoDetails ?? {};
    const uploadDate = micro.uploadDate || micro.publishDate || null;
    const isoDate = uploadDate ? uploadDate.replace(/T.*/, "").slice(0, 10) : null;

    const result = {
      ok: true,
      publishedAt: isoDate,
      title: details.title || micro.title?.simpleText || null,
      channel: details.author || micro.ownerChannelName || null,
      viewCount: details.viewCount || null,
      description: details.shortDescription || micro.description?.simpleText || null,
      thumbnail: micro.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
    };

    if (nextRes?.ok) {
      try {
        const nextData = await nextRes.json();
        const comments = extractComments(nextData);
        if (comments.length > 0) result.comments = comments;
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};

function extractComments(data) {
  const comments = [];
  try {
    const items =
      data?.onResponseReceivedEndpoints
        ?.flatMap((e) =>
          e?.reloadContinuationItemsCommand?.continuationItems ??
          e?.appendContinuationItemsAction?.continuationItems ?? []
        ) ?? [];

    for (const item of items) {
      const thread = item?.commentThreadRenderer;
      if (!thread) continue;
      const c = thread.comment?.commentRenderer;
      if (!c) continue;

      const author = c.authorText?.simpleText || "";
      const text = (c.contentText?.runs ?? []).map((r) => r.text || "").join("");
      const likes = c.voteCount?.simpleText || "";
      const time = c.publishedTimeText?.runs?.map((r) => r.text || "").join("") || "";

      if (text.trim()) {
        comments.push({ author, text, likes, time });
      }
      if (comments.length >= 15) break;
    }
  } catch { /* ignore */ }
  return comments;
}

export const config = { path: "/.netlify/functions/youtube-date" };
