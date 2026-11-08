import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
http.createServer(async (req, res) => {
    try {
        const p = resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/index.html")));
        if (!p.startsWith(root + sep)) {
            res.writeHead(403).end();
            return;
        }
        res.setHeader("Content-Type", { ".js": "text/javascript", ".html": "text/html" }[extname(p)] ?? "application/octet-stream");
        res.end(await readFile(p));
    } catch {
        res.writeHead(404).end();
    }
}).listen(Number(process.env.PORT ?? 8098), "127.0.0.1");
