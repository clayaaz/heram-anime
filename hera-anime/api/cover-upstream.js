const ALLOWED_HOST = /^s\d+\.anilist\.co$/i;

export function parseCoverTarget(raw) {
  if (!raw) return { error: "Missing url", status: 400 };

  let target;
  try {
    target = new URL(raw);
  } catch {
    return { error: "Bad url", status: 400 };
  }

  if (target.protocol !== "https:" || !ALLOWED_HOST.test(target.hostname)) {
    return { error: "Host not allowed", status: 400 };
  }

  return { url: target.toString() };
}

export async function fetchCover(rawUrl) {
  const parsed = parseCoverTarget(rawUrl);
  if (parsed.error) {
    return {
      status: parsed.status,
      contentType: "text/plain; charset=utf-8",
      body: parsed.error,
      error: true,
    };
  }

  const upstream = await fetch(parsed.url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "HeraAnime/1.0 (https://anime.shreyazray.com.np)",
    },
  });

  return {
    status: upstream.status,
    contentType: upstream.headers.get("Content-Type") || "image/jpeg",
    body: await upstream.arrayBuffer(),
  };
}
