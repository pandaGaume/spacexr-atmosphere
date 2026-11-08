import { AtmosphereSky } from "@spacexr/atmosphere/webgpu";
import { integrateSpectral } from "@spacexr/atmosphere";
import { displayPipeline } from "/sky-consumer/display.js";
import { probeSky } from "/sky-consumer/probe.js";

/** Laboratory presentation and diagnostics around the public renderer. */
export class PublicGpuSky {
    static async create(device, canvas, model, camera, options) {
        const renderer = new PublicGpuSky(device, canvas, model, camera, options);
        renderer.sky = await AtmosphereSky.create(device, model, {
            width: options.width,
            hemisphereRows: options.hemisphereRows,
            viewSteps: options.samples,
            solarSteps: model.solarSteps,
            ...Object.fromEntries(
                ["source", "starTemperature", "distanceAU", "bandCenter", "bandWidth", "wavelengths"].map((k) => [
                    k,
                    options.spectral.config[k],
                ]),
            ),
        });
        return renderer;
    }
    constructor(device, canvas, model, camera, options) {
        this.device = device;
        this.canvas = canvas;
        this.model = model;
        this.camera = camera;
        this.origin = [...camera.origin];
        this.spectral = options.spectral;
        this.options = options;
        this.layout = { width: options.width, height: options.hemisphereRows * 2, samples: options.samples };
        this.exposure = 12;
        this.sunEnabled = false;
        this.width = canvas.width;
        this.height = canvas.height;
        this.context = canvas.getContext("webgpu");
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device,
            format: this.format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
    }
    cameraInput() {
        const c = this.camera,
            r = c.right,
            u = c.up,
            f = c.forward,
            cross = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]],
            right = cross.reduce((sum, v, i) => sum + v * f[i], 0) > 0 ? r.map((v) => -v) : r;
        return {
            positionEcefMeters: this.camera.origin,
            forwardEcef: this.camera.forward,
            rightEcef: right,
            upEcef: this.camera.up,
            halfWidthTangent: this.camera.halfWidth,
            halfHeightTangent: this.camera.halfHeight,
            viewportWidth: this.width,
            viewportHeight: this.height,
        };
    }
    resize(width, height) {
        if (![width, height].every((v) => Number.isInteger(v) && v > 0)) throw new Error("Invalid viewport");
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
    }
    writeCamera(camera, exposure = this.exposure) {
        if (!(Number.isFinite(exposure) && exposure > 0)) throw new Error("Invalid exposure");
        this.camera = camera;
        this.origin = [...camera.origin];
        this.exposure = exposure;
        this.sky.update(this.cameraInput());
    }
    async build() {
        const start = performance.now();
        this.sky.update(this.cameraInput());
        let ready = false;
        while (!ready) {
            const construction = this.device.createCommandEncoder();
            ready = this.sky.encode(construction);
            this.device.queue.submit([construction.finish()]);
            await this.device.queue.onSubmittedWorkDone();
        }
        const encoder = this.device.createCommandEncoder();
        this.display ??= await displayPipeline(this.device, this.sky, this.format);
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        return {
            ms: performance.now() - start,
            gpuMs: null,
            width: this.layout.width,
            height: this.layout.height,
            samples: this.layout.samples,
            implementation: "@spacexr/atmosphere/webgpu",
        };
    }
    draw(camera = this.camera, exposure = this.exposure) {
        this.writeCamera(camera, exposure);
        const encoder = this.device.createCommandEncoder();
        if (!this.sky.encode(encoder)) {
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        this.display.encode(encoder, this.context.getCurrentTexture().createView(), this.cameraInput(), exposure);
        this.device.queue.submit([encoder.finish()]);
    }
    async measureDisplay() {
        const start = performance.now();
        this.draw();
        await this.device.queue.onSubmittedWorkDone();
        return { ms: performance.now() - start, gpuMs: null, width: this.width, height: this.height, imageReadback: false };
    }
    async sampleRays(rays) {
        const values = await probeSky(this.device, this.sky, rays);
        return values.map((radiance) => ({ radiance }));
    }
    async validate() {
        const rays = [];
        for (const v of [0.2, 0.48, 0.8]) for (const u of [0.2, 0.5, 0.8]) rays.push(this.camera.ray(u, v));
        const cached = await this.sampleRays(rays),
            reference = rays.map((d) => integrateSpectral(this.spectral, this.origin, d));
        let sum = 0,
            max = 0;
        cached.forEach((v, i) =>
            v.radiance.forEach((x, c) => {
                const e = Math.abs(x - reference[i].radiance[c]);
                sum += e * e;
                max = Math.max(max, e);
            }),
        );
        return {
            probes: rays.length,
            maxRadianceError: max,
            radianceRMSE: Math.sqrt(sum / (rays.length * 3)),
            reference: "Independent public CPU spectral integration; public packed WebGPU readers",
            raySamples: rays.map((direction, i) => ({ direction, cachedRgb: cached[i].radiance, referenceRgb: reference[i].radiance })),
        };
    }
    encodeDisplay(encoder) {
        if (!this.sky.encode(encoder)) throw new Error("Complete sky construction before capture");
        this.display.encode(encoder, this.context.getCurrentTexture().createView(), this.cameraInput(), this.exposure);
    }
    async capturePng() {
        const d = this.device,
            width = this.width,
            height = this.height;
        const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
        const staging = d.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            const encoder = d.createCommandEncoder();
            this.encodeDisplay(encoder);
            encoder.copyTextureToBuffer(
                { texture: this.context.getCurrentTexture() },
                { buffer: staging, bytesPerRow, rowsPerImage: height },
                [width, height],
            );
            d.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            const source = new Uint8Array(staging.getMappedRange()),
                pixels = new Uint8ClampedArray(width * height * 4);
            const bgra = this.format.startsWith("bgra");
            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const from = y * bytesPerRow + x * 4,
                        to = (y * width + x) * 4;
                    pixels[to] = source[from + (bgra ? 2 : 0)];
                    pixels[to + 1] = source[from + 1];
                    pixels[to + 2] = source[from + (bgra ? 0 : 2)];
                    pixels[to + 3] = 255;
                }
            staging.unmap();
            const canvas = new OffscreenCanvas(width, height);
            canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
            return canvas.convertToBlob({ type: "image/png" });
        } finally {
            staging.destroy();
        }
    }
    dispose() {
        this.display?.dispose();
        this.sky?.dispose();
        this.context.unconfigure();
    }
}
