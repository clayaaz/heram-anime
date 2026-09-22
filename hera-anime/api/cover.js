import { fetchCover } from "./cover-upstream.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const raw = new URL(request.url).searchParams.get("u");
  const result = await fetchCover(raw);

  return new Response(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": result.error ? "no-store" : "public, max-age=86400, s-maxage=604800",
    },
  });
}
