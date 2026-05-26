/**
 * Netlify Function: YouTube 업로드일 조회 (innertube API)
 * GET /.netlify/functions/youtube-date?v=VIDEO_ID
 */
export default async (req) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("v");

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return new Response(JSON.stringify({ error: "invalid video id" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const body = JSON.stringify({
    context: {
      client: { clientName: "WEB", clientVersion: "2.20240101.01.00" },
    },
    videoId,
  });

  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body,
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "innertube error", status: res.status }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const data = await res.json();
    const micro = data?.microformat?.playerMicroformatRenderer ?? {};
    const uploadDate = micro.uploadDate || micro.publishDate || null;
    const title = micro.title?.simpleText || null;
    const thumbnail = micro.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null;

    const isoDate = uploadDate ? uploadDate.replace(/T.*/, "").slice(0, 10) : null;

    return new Response(
      JSON.stringify({ ok: true, publishedAt: isoDate, title, thumbnail }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
};

export const config = { path: "/.netlify/functions/youtube-date" };
