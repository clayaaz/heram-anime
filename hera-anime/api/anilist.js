import { fetchAniList } from "./anilist-upstream.js";

export const config = { runtime: "edge" };

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default async function handler(request) {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.text();
    const upstream = await fetchAniList(body);
    return new Response(upstream.text, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.contentType,
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ errors: [{ message: error.message || "AniList proxy failed" }] }),
      {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
}
