import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { propose, prepareRequest } from "./model";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 5188);
const enabled =
  process.env.ENABLE_NEBIUS === "1" &&
  !!process.env.NEBIUS_API_KEY &&
  !!process.env.NEBIUS_MODEL;
const maxCalls = Math.min(
  100,
  Math.max(0, Number(process.env.MAX_MODEL_CALLS || 20) || 0),
);
const usageFile = resolve(root, ".cache/model-usage.json");
mkdirSync(resolve(root, ".cache"), { recursive: true });
let usage: { reservedCalls: number; lastResult?: unknown } = {
  reservedCalls: 0,
};
let quotaHealthy = true;
if (existsSync(usageFile)) {
  try {
    usage = JSON.parse(readFileSync(usageFile, "utf8"));
    if (!Number.isInteger(usage.reservedCalls) || usage.reservedCalls < 0)
      throw new Error();
  } catch {
    quotaHealthy = false;
  }
}
let busy = false;
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  "http://127.0.0.1:5187",
  "http://localhost:5187",
]);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  try {
    if (
      !req.headers.host ||
      !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host)
    )
      return send(403, { error: "Local host only." });
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname === "/api/status" && req.method === "GET")
      return send(200, {
        configured: enabled && quotaHealthy,
        model: enabled ? process.env.NEBIUS_MODEL : null,
        remainingCalls: quotaHealthy
          ? Math.max(0, maxCalls - usage.reservedCalls)
          : 0,
      });
    if (pathname === "/api/propose" && req.method === "POST") {
      if (!req.headers.origin || !allowedOrigins.has(req.headers.origin))
        return send(403, {
          error: "Open the local workbench to request a proposal.",
        });
      if (!enabled || !quotaHealthy)
        return send(503, {
          error:
            "Nebius is not enabled. Use local matching, or configure verified free credits on the server.",
        });
      if (busy)
        return send(429, {
          error: "A proposal is already running. Please wait.",
        });
      if (usage.reservedCalls >= maxCalls)
        return send(429, {
          error:
            "The local call cap has been reached. No request was sent to Nebius.",
        });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return send(415, { error: "JSON required." });
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64000) return send(413, { error: "Profile is too large." });
        chunks.push(chunk);
      }
      let input;
      try {
        input = prepareRequest(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
      } catch {
        return send(400, {
          error: "The profile is invalid. No request was sent.",
        });
      }
      // Recheck after reading an asynchronous request body; reserve and persist before calling the model.
      if (busy || usage.reservedCalls >= maxCalls)
        return send(429, {
          error: "Request cap reached or another request is running.",
        });
      busy = true;
      try {
        usage.reservedCalls++;
        writeFileSync(usageFile, JSON.stringify(usage, null, 2));
        const result = await propose(input, {
          key: process.env.NEBIUS_API_KEY!,
          model: process.env.NEBIUS_MODEL!,
        });
        usage.lastResult = {
          at: new Date().toISOString(),
          model: result.model,
          latencyMs: result.latencyMs,
          usage: result.usage,
          sampleCount: result.sampleCount,
        };
        writeFileSync(usageFile, JSON.stringify(usage, null, 2));
        return send(200, result);
      } catch (error) {
        return send(502, {
          error:
            error instanceof Error
              ? error.message
              : "Proposal failed; no recipe applied.",
        });
      } finally {
        busy = false;
      }
    }
    if (pathname.startsWith("/api/"))
      return send(404, { error: "Unknown API route." });
    if (req.method !== "GET")
      return send(405, { error: "Method not allowed." });
    const dist = resolve(root, "dist");
    const file = resolve(
      dist,
      "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(dist + sep) || !existsSync(file))
      return send(404, {
        error:
          "Build the app first with npm run build, or use the development server on port 5187.",
      });
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
    });
    res.end(readFileSync(file));
  } catch {
    if (!res.headersSent)
      send(500, { error: "The request could not be completed." });
    else res.end();
  }
}).listen(port, "127.0.0.1", () =>
  console.log(
    `ImportProof API: http://127.0.0.1:${port} · Nebius ${enabled ? "enabled" : "disabled"} · call cap ${maxCalls}`,
  ),
);
