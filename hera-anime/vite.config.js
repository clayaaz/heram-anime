import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fetchAniList } from './api/anilist-upstream.js'
import { fetchCover } from './api/cover-upstream.js'

function anilistDevProxy() {
  async function handleAniList(req, res) {
    if (req.method === "OPTIONS") {
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method !== "POST") {
      res.statusCode = 405
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error: "Method not allowed" }))
      return
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString("utf8")

    try {
      const upstream = await fetchAniList(body)
      res.statusCode = upstream.status
      res.setHeader("Content-Type", upstream.contentType)
      res.end(upstream.text)
    } catch (error) {
      res.statusCode = 502
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ errors: [{ message: error.message || "AniList proxy failed" }] }))
    }
  }

  async function handleCover(req, res) {
    if (req.method !== "GET") {
      res.statusCode = 405
      res.end("Method not allowed")
      return
    }

    const raw = new URL(req.url, "http://localhost").searchParams.get("u")
    try {
      const result = await fetchCover(raw)
      res.statusCode = result.status
      res.setHeader("Content-Type", result.contentType)
      res.setHeader("Cache-Control", result.error ? "no-store" : "public, max-age=86400")
      res.end(result.error ? result.body : Buffer.from(result.body))
    } catch (error) {
      res.statusCode = 502
      res.end(error.message || "Cover proxy failed")
    }
  }

  return {
    name: "anilist-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/anilist", handleAniList)
      server.middlewares.use("/api/cover", handleCover)
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/anilist", handleAniList)
      server.middlewares.use("/api/cover", handleCover)
    },
  }
}

export default defineConfig({
  plugins: [react(), anilistDevProxy()],
})
