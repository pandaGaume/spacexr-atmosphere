import { readFile, writeFile } from "node:fs/promises";
const url = new URL("../dist/webgpu.d.ts", import.meta.url);
await writeFile(url, '/// <reference types="@webgpu/types" />\n' + (await readFile(url, "utf8")));
