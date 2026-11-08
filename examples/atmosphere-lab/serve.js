import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const labRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(labRoot, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wgsl': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        const root = pathname.startsWith('/sky-consumer/') ? path.join(packageRoot,'examples') : pathname.startsWith('/dist/') || pathname.startsWith('/node_modules/@spacexr/geodesy/dist/') ? packageRoot : labRoot;
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        const content = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
    } catch { response.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT || 8097), '127.0.0.1', () => console.log(`Atmosphere prototype: http://127.0.0.1:${server.address().port}`));
