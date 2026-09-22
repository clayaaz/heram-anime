const ANILIST_URL = "https://graphql.anilist.co/";

export async function fetchAniList(body) {
  const upstream = await fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "HeraAnime/1.0 (https://anime.shreyazray.com.np)",
    },
    body,
  });

  return {
    status: upstream.status,
    text: await upstream.text(),
    contentType: upstream.headers.get("Content-Type") || "application/json",
  };
}
