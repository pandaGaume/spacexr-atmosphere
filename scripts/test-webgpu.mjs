import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, cp } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { execFileSync, spawn } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
await mkdir(resolve(root, ".cache"), { recursive: true });
const consumer = await mkdtemp(resolve(root, ".cache/sky-consumer-"));
await mkdir(consumer, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args, cwd) {
    return execFileSync(npm, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}
const packed = JSON.parse(run(["pack", "--ignore-scripts", "--json"], root))[0];
await cp(resolve(root, "examples/sky-consumer"), consumer, { recursive: true });
await writeFile(
    resolve(consumer, "package.json"),
    JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@spacexr/atmosphere": `file:${resolve(root, packed.filename).replaceAll("\\", "/")}` },
    }),
);
run(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
if (
    (await readFile(resolve(consumer, "node_modules/@spacexr/atmosphere/dist/webgpu.js"), "utf8")) !==
    (await readFile(resolve(root, "dist/webgpu.js"), "utf8"))
)
    throw new Error("Packed consumer differs from current build");
await writeFile(
    resolve(consumer, "types.ts"),
    'import {AtmosphereSky,type IAtmosphereCamera} from "@spacexr/atmosphere/webgpu"; import type {IAtmosphere} from "@spacexr/atmosphere"; export async function create(device:GPUDevice,model:IAtmosphere,camera:IAtmosphereCamera){const sky=await AtmosphereSky.create(device,model);sky.update(camera);return sky;}',
);
execFileSync(
    process.execPath,
    [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--lib",
        "ES2022,DOM",
        "types.ts",
    ],
    { cwd: consumer, stdio: "inherit" },
);
await writeFile(
    resolve(consumer, "core-types.ts"),
    'import type {IAtmosphere} from "@spacexr/atmosphere"; export type CoreAtmosphere = IAtmosphere;',
);
execFileSync(
    process.execPath,
    [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--lib",
        "ES2022",
        "core-types.ts",
    ],
    { cwd: consumer, stdio: "inherit" },
);
await cp(resolve(root, "tests/browser"), resolve(consumer, "tests"), { recursive: true });
await cp(resolve(root, "tests/webgpu-tolerances.json"), resolve(consumer, "tests/tolerances.json"));
const server = createServer(async (req, res) => {
    try {
        if (req.url === "/favicon.ico") {
            res.writeHead(204).end();
            return;
        }
        const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        const file = resolve(consumer, "." + (pathname === "/" ? "/index.html" : pathname));
        if (!file.startsWith(consumer + sep)) {
            res.writeHead(403).end();
            return;
        }
        res.setHeader(
            "Content-Type",
            { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" }[extname(file)] ?? "application/octet-stream",
        );
        res.end(await readFile(file));
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser, labProcess;
try {
    const channel = process.env.CHROME_CHANNEL ?? "chrome";
    browser = await chromium.launch({
        ...(channel === "chromium" ? {} : { channel }),
        headless: true,
        args:
            process.platform === "win32"
                ? ["--enable-unsafe-webgpu"]
                : ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan", "--disable-vulkan-surface"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        console.log("BROWSER", m.text());
        if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/index.html${process.env.WEBGPU_LAB_ONLY ? "?labOnly=1" : ""}`);
    const report = await page.evaluate(async () => await window.validation);
    if (errors.length) throw new Error(errors.join("\n"));
    report.browser = browser.version();
    await writeFile(
        resolve(root, process.env.WEBGPU_LAB_ONLY ? ".cache/webgpu-smoke.json" : ".cache/webgpu-validation.json"),
        JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ cases: report.cases.length, failures: report.failures, browser: report.browser }));
    if (report.failures.length) process.exitCode = 1;
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.skyError || document.querySelector("#status").textContent.startsWith("Altitude"), null, {
        timeout: 120000,
    });
    if (await page.evaluate(() => window.skyError)) throw new Error(await page.evaluate(() => window.skyError));
    await page.screenshot({ path: resolve(root, ".cache/sky-consumer.png") });
    for (const [key, height] of [
        ["KeyO", 150000],
        ["KeyG", 1],
        ["KeyW", 1001],
    ]) {
        await page.keyboard.press(key);
        await page.waitForFunction(
            (expected) => window.skyError || document.querySelector("#status").textContent.startsWith(`Altitude ${expected} m.`),
            height,
            { timeout: 120000 },
        );
        if (await page.evaluate(() => window.skyError)) throw new Error(await page.evaluate(() => window.skyError));
    }
    const previous = await page.evaluate(() => window.skyFrame);
    await page.mouse.move(320, 180);
    await page.mouse.down();
    await page.mouse.move(380, 200);
    await page.mouse.up();
    await page.waitForFunction((frame) => window.skyFrame > frame, previous, { timeout: 120000 });
    const labAddress = await new Promise((resolveAddress, reject) => {
        labProcess = spawn(process.execPath, [resolve(root, "examples/atmosphere-lab/serve.js")], {
            cwd: root,
            env: { ...process.env, PORT: "0" },
            windowsHide: true,
        });
        labProcess.once("error", reject);
        labProcess.once("exit", (code) => reject(new Error("Laboratory exited " + code)));
        labProcess.stdout.on("data", (chunk) => {
            const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
            if (match) resolveAddress(match[0]);
        });
    });
    await page.goto(labAddress);
    await page.selectOption("#transport", "spectral");
    await page.selectOption("#hdDefinition", "1280");
    await page.selectOption("#skyLutQuality", "128");
    await page.uncheck("#hdFrameSun");
    await page.click("#renderhd");
    await page.waitForFunction(
        () => window.atmosphereHDResult || /Error|error/.test(document.querySelector("#hdStatus").textContent),
        null,
        { timeout: 120000 },
    );
    const labReport = await page.evaluate(() => window.atmosphereHDResult);
    if (!labReport) throw new Error(await page.locator("#hdStatus").textContent());
    if (labReport.skyView.implementation !== "@spacexr/atmosphere/webgpu") throw new Error("Laboratory bypassed public renderer");
    await writeFile(resolve(root, ".cache/lab-public-validation.json"), JSON.stringify(labReport, null, 2));
    const downloadPromise = page.waitForEvent("download");
    await page.click("#savehd");
    const download = await downloadPromise;
    await download.saveAs(resolve(root, ".cache/lab-public.png"));
    if (await download.failure()) throw new Error(await download.failure());
    if (errors.length) throw new Error(errors.join("\n"));
} finally {
    labProcess?.kill();
    await browser?.close();
    await new Promise((r) => server.close(r));
}
