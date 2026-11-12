import http from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.env.CONTAINER_PORT || 3000);
const host = "0.0.0.0";


async function buildSitemap() {
  const entries = await readdir(root, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);
  const urls = [];
  for (const file of htmlFiles) {
    const info = await stat(path.join(root, file));
    const loc = file === "index.html"
      ? "https://mudancasbrasil.com.br/"
      : `https://mudancasbrasil.com.br/${encodeURIComponent(file)}`;
    const priority = file === "index.html" ? "1.0" : file === "privacidade.html" ? "0.2" : "0.8";
    const frequency = file === "privacidade.html" ? "yearly" : "monthly";
    urls.push(`  <url><loc>${loc}</loc><lastmod>${info.mtime.toISOString().slice(0, 10)}</lastmod><changefreq>${frequency}</changefreq><priority>${priority}</priority></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Allow": "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method Not Allowed");
    }

    const url = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const target = path.resolve(root, "." + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Forbidden");
    }

    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");

    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": path.extname(target) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    if (req.method === "HEAD") return res.end();
    return res.end(body);
  } catch (error) {
    const status = error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(status === 404 ? "Not Found" : "Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Vértice Mudanças disponível em http://${host}:${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
