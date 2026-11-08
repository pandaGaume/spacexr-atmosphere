/// <reference types="@webgpu/types" />
import { makeSpectralScene, phaseTable, spectrumBuffer } from "../src/spectrum";
import { copyLayerProfile, packLayerProfiles } from "../src/layers";
import type { IAtmosphere } from "../src/layers";
import { copyCamera, horizonMetadata, split } from "./camera";
import geometry from "./generated/geometry";
import transport from "./generated/transport";
import read from "./generated/read";
import bake from "./generated/bake";
import solarBake from "./generated/solar";
import { geodeticPosition } from "../src/geometry";
import type { IAtmosphereCamera, IAtmosphereSkyBindings, IAtmosphereSkyOptions } from "./types";
export type { EcefVector, IAtmosphereCamera, IAtmosphereSkyBindings, IAtmosphereSkyOptions } from "./types";

/** Complete group-0 WGSL readers. Compose without source substitutions. */
export const atmosphereSkyWgsl = geometry + transport + read;

/** Per-view spectral Sky-View cache borrowing a host-owned WebGPU device. */
export class AtmosphereSky {
    private readonly uploads: GPUBuffer[] = [];
    private solarPipeline!: GPUComputePipeline;
    private solarGroups: GPUBindGroup[] = [];
    private solarUniforms: GPUBuffer[] = [];
    private solarCursor = 0;
    private skyCursor = 0;
    private readonly resources: Array<GPUBuffer | GPUTexture> = [];
    private disposed = false;
    private lost = false;
    private encoded = false;
    private dirty = true;
    private camera: IAtmosphereCamera | undefined;
    private frame: Float32Array | undefined;
    private horizon: Float32Array | undefined;
    private readonly width: number;
    private readonly rows: number;
    private readonly viewSteps: number;
    private readonly solarSteps: number;
    private readonly model: { ellipsoid: { semiMajorAxis: number; semiMinorAxis: number }; top: number; sun: number[] };
    private readonly wavelengths: number;
    private uniform!: GPUBuffer;
    private horizonBuffer!: GPUBuffer;
    private pipeline!: GPUComputePipeline;

    private bandGroups: GPUBindGroup[] = [];
    private bandUniforms: GPUBuffer[] = [];
    private readers!: IAtmosphereSkyBindings;

    /** Compiles pipelines and snapshots physical inputs; never submits GPU commands. */
    public static async create(device: GPUDevice, atmosphere: IAtmosphere, options: IAtmosphereSkyOptions = {}): Promise<AtmosphereSky> {
        const sky = new AtmosphereSky(device, atmosphere, options);
        try {
            await sky.initialize(atmosphere, options);
            sky.assertLive();
            return sky;
        } catch (error) {
            sky.dispose();
            throw error;
        }
    }
    private constructor(
        private readonly device: GPUDevice,
        atmosphere: IAtmosphere,
        options: IAtmosphereSkyOptions,
    ) {
        this.width = options.width ?? 64;
        this.rows = options.hemisphereRows ?? 64;
        this.viewSteps = options.viewSteps ?? 256;
        this.solarSteps = options.solarSteps ?? 192;
        for (const [value, min, max] of [
            [this.width, 8, 1024],
            [this.rows, 4, 256],
            [this.viewSteps, 8, 2048],
            [this.solarSteps, 8, 1024],
        ])
            if (!Number.isInteger(value) || value < min || value > max) throw new Error("Invalid Sky-View quality");
        if (atmosphere.layers.length < 1 || atmosphere.layers.length > 4) throw new Error("WebGPU requires one to four analytic layers");
        const a = atmosphere.ellipsoid.semiMajorAxis,
            b = atmosphere.ellipsoid.semiMinorAxis;
        if (![a, b, atmosphere.top].every((v) => Number.isFinite(v) && v > 0) || b > a)
            throw new Error("Invalid ellipsoid or atmosphere top");
        if (
            atmosphere.sun.length !== 3 ||
            !atmosphere.sun.every(Number.isFinite) ||
            Math.abs(atmosphere.sun.reduce((s, v) => s + v * v, 0) - 1) > 1e-6
        )
            throw new Error("Sun must be a unit ECEF direction");
        this.model = { ellipsoid: { semiMajorAxis: a, semiMinorAxis: b }, top: atmosphere.top, sun: [...atmosphere.sun] };
        this.wavelengths = options.wavelengths ?? 24;
        const target = new WeakRef(this);
        void device.lost.then(() => {
            const sky = target.deref();
            if (sky) sky.lost = true;
        });
    }
    private buffer(data: Float32Array, usage: GPUBufferUsageFlags): GPUBuffer {
        const buffer = this.device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
        this.resources.push(buffer);
        this.device.queue.writeBuffer(buffer, 0, data as Float32Array<ArrayBuffer>);
        return buffer;
    }
    private async initialize(atmosphere: IAtmosphere, options: IAtmosphereSkyOptions): Promise<void> {
        for (const layer of atmosphere.layers) copyLayerProfile(layer.profile);
        const scene = makeSpectralScene(atmosphere, {
            ...(options.source !== undefined ? { source: options.source } : {}),
            ...(options.starTemperature !== undefined ? { starTemperature: options.starTemperature } : {}),
            ...(options.distanceAU !== undefined ? { distanceAU: options.distanceAU } : {}),
            ...(options.bandCenter !== undefined ? { bandCenter: options.bandCenter } : {}),
            ...(options.bandWidth !== undefined ? { bandWidth: options.bandWidth } : {}),
            wavelengths: this.wavelengths as 24 | 48,
        });
        const profiles = packLayerProfiles(atmosphere),
            spectrum = spectrumBuffer(scene),
            phase = phaseTable(scene);
        if (
            scene.bins.some((bin) =>
                bin.layers.some(
                    (layer) =>
                        ![layer.rayleigh, layer.scattering, layer.extinction].every((v) => Number.isFinite(v) && v >= 0) ||
                        layer.extinction + 1e-20 < layer.rayleigh + layer.scattering,
                ),
            ) ||
            phase.data.some((v) => v < 0)
        )
            throw new Error("Invalid physical optical coefficients");
        if (![...profiles, ...spectrum, ...phase.data].every(Number.isFinite))
            throw new Error("Physical snapshot contains non-finite coefficients");
        if (
            this.width > this.device.limits.maxTextureDimension2D ||
            this.rows * 2 > this.device.limits.maxTextureDimension2D ||
            scene.groups > this.device.limits.maxTextureArrayLayers ||
            phase.height > this.device.limits.maxTextureDimension2D ||
            phase.width > this.device.limits.maxTextureDimension2D ||
            spectrum.byteLength > this.device.limits.maxStorageBufferBindingSize ||
            this.device.limits.maxTextureDimension3D < 64 ||
            this.device.limits.maxSampledTexturesPerShaderStage < 4 ||
            this.device.limits.maxStorageBufferBindingSize < 2097152 ||
            this.device.limits.maxBufferSize < 2097152 ||
            this.device.limits.maxStorageTexturesPerShaderStage < 2 ||
            this.device.limits.maxStorageBuffersPerShaderStage < 3
        )
            throw new Error("Insufficient WebGPU limits for atmosphere resources");
        const compile = async (code: string, entryPoint: string) => {
            const module = this.device.createShaderModule({ label: entryPoint, code });
            const info = await module.getCompilationInfo();
            const errors = info.messages.filter((m) => m.type === "error");
            if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}: ${m.message}`).join("\n"));
            return this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint } });
        };
        this.pipeline = await compile(geometry + transport + bake, "atmosphere_bake");
        this.solarPipeline = await compile(geometry + transport + solarBake, "atmosphere_bakeSolar");
        this.device.pushErrorScope("validation");
        try {
            this.uniform = this.buffer(new Float32Array(40), GPUBufferUsage.UNIFORM);
            const profileBuffer = this.buffer(profiles, GPUBufferUsage.STORAGE),
                spectrumBufferResource = this.buffer(spectrum, GPUBufferUsage.STORAGE);
            this.horizonBuffer = this.buffer(new Float32Array(this.width), GPUBufferUsage.STORAGE);
            const phaseTexture = this.device.createTexture({
                size: [phase.width, phase.height],
                format: "rgba32float",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.resources.push(phaseTexture);
            this.device.queue.writeTexture(
                { texture: phaseTexture },
                phase.data as Float32Array<ArrayBuffer>,
                { bytesPerRow: phase.width * 16 },
                [phase.width, phase.height],
            );
            const texture = () => {
                const t = this.device.createTexture({
                    size: [this.width, this.rows * 2, scene.groups],
                    format: "rgba16float",
                    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
                });
                this.resources.push(t);
                return t.createView({ dimension: "2d-array" });
            };
            const radiance = texture(),
                transmission = texture();
            const solarSize = [64, 32, 32];
            const solarTexture = this.device.createTexture({
                dimension: "3d",
                size: solarSize,
                format: "rgba32float",
                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            });
            this.resources.push(solarTexture);
            const points = new Float32Array(solarSize[0] * solarSize[1] * solarSize[2] * 8);
            const declination = this.model.sun[2],
                sunLongitude = Math.atan2(this.model.sun[1], this.model.sun[0]);
            for (let z = 0; z < solarSize[2]; z++)
                for (let y = 0; y < solarSize[1]; y++)
                    for (let x = 0; x < solarSize[0]; x++) {
                        const latitude = (y / (solarSize[1] - 1) - 0.5) * Math.PI;
                        const center = Math.acos(
                            Math.max(
                                -Math.cos(0.1),
                                Math.min(
                                    Math.cos(0.1),
                                    (-Math.sin(latitude) * declination) /
                                        Math.max(1e-8, Math.cos(latitude) * Math.sqrt(Math.max(0, 1 - declination ** 2))),
                                ),
                            ),
                        );
                        const t = (2 * x) / (solarSize[0] - 1) - 1,
                            longitude = (t < 0 ? center * (1 - t * t) : center + (Math.PI - center) * t * t) + sunLongitude;
                        const point = geodeticPosition(
                            this.model.ellipsoid,
                            latitude,
                            longitude,
                            this.model.top * (z / (solarSize[2] - 1)) ** 2,
                        );
                        const offset = ((z * solarSize[1] + y) * solarSize[0] + x) * 8;
                        for (let i = 0; i < 3; i++) {
                            const axis = i === 2 ? this.model.ellipsoid.semiMinorAxis : this.model.ellipsoid.semiMajorAxis;
                            const [hi, lo] = split(point[i] / axis);
                            points[offset + i] = hi;
                            points[offset + 4 + i] = lo;
                        }
                    }
            const pointBuffer = this.buffer(points, GPUBufferUsage.STORAGE);
            for (let slice = 0; slice < 256; slice++) {
                const uniform = this.buffer(new Float32Array(40), GPUBufferUsage.UNIFORM);
                this.solarUniforms.push(uniform);
                this.solarGroups.push(
                    this.device.createBindGroup({
                        layout: this.solarPipeline.getBindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniform } },
                            { binding: 1, resource: { buffer: profileBuffer } },
                            { binding: 4, resource: solarTexture.createView({ dimension: "3d" }) },
                            { binding: 9, resource: { buffer: pointBuffer } },
                        ],
                    }),
                );
            }
            const common: GPUBindGroupEntry[] = [
                { binding: 0, resource: { buffer: this.uniform } },
                { binding: 1, resource: { buffer: profileBuffer } },
                { binding: 2, resource: { buffer: spectrumBufferResource } },
                { binding: 3, resource: phaseTexture.createView() },
                { binding: 7, resource: { buffer: this.horizonBuffer } },
                { binding: 8, resource: solarTexture.createView({ dimension: "3d" }) },
            ];
            for (let band = 0; band < scene.groups * Math.ceil((this.rows * 2) / 4); band++) {
                const bandUniform = this.buffer(new Float32Array(40), GPUBufferUsage.UNIFORM);
                this.bandUniforms.push(bandUniform);
                const views = [radiance, transmission].map((view) => view);
                this.bandGroups.push(
                    this.device.createBindGroup({
                        layout: this.pipeline.getBindGroupLayout(0),
                        entries: [
                            ...common.filter((e) => e.binding !== 0),
                            { binding: 0, resource: { buffer: bandUniform } },
                            { binding: 4, resource: views[0] },
                            { binding: 5, resource: views[1] },
                        ],
                    }),
                );
            }
            const all = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
            const layout = this.device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: all, buffer: { type: "uniform" } },
                    ...[1, 2, 7].map((binding) => ({ binding, visibility: all, buffer: { type: "read-only-storage" as const } })),
                    { binding: 3, visibility: all, texture: { sampleType: "unfilterable-float" } },
                    { binding: 8, visibility: all, texture: { sampleType: "unfilterable-float", viewDimension: "3d" } },
                    ...[4, 5].map((binding) => ({ binding, visibility: all, texture: { viewDimension: "2d-array" as const } })),
                    { binding: 6, visibility: all, sampler: { type: "filtering" } },
                ],
            });
            const sampler = this.device.createSampler({
                addressModeU: "repeat",
                addressModeV: "clamp-to-edge",
                minFilter: "linear",
                magFilter: "linear",
            });
            const group = this.device.createBindGroup({
                layout,
                entries: [
                    ...common,
                    { binding: 4, resource: radiance },
                    { binding: 5, resource: transmission },
                    { binding: 6, resource: sampler },
                ],
            });
            this.readers = {
                layout,
                group,
                generation: 1,
                radiance,
                transmission,
                solarColumns: solarTexture.createView({ dimension: "3d" }),
                wavelengths: this.wavelengths,
            };
        } catch (error) {
            await this.device.popErrorScope();
            throw error;
        }
        const error = await this.device.popErrorScope();
        if (error) throw new Error(error.message);
    }
    private assertLive(): void {
        if (this.disposed) throw new Error("Atmosphere sky is disposed");
        if (this.lost) throw new Error("Atmosphere device is lost");
    }
    /** Copies a camera. Any translation invalidates the cached sky; no GPU work occurs. */
    public update(camera: IAtmosphereCamera): void {
        this.assertLive();
        const next = copyCamera(camera, this.model.ellipsoid);
        const moved = !this.camera || next.positionEcefMeters.some((v, i) => v !== this.camera!.positionEcefMeters[i]);
        this.camera = next;
        if (!moved) return;
        const metadata = horizonMetadata(this.model.ellipsoid, next.positionEcefMeters, this.width);
        const axes = [this.model.ellipsoid.semiMajorAxis, this.model.ellipsoid.semiMajorAxis, this.model.ellipsoid.semiMinorAxis];
        const origin = axes.map((a, i) => split(next.positionEcefMeters[i] / a)),
            inverse = axes.map((a) => split(1000 / a));
        const frame = new Float32Array(40);
        frame.set(
            origin.map((v) => v[0]),
            0,
        );
        frame[3] = this.model.top / 1000;
        frame.set(
            origin.map((v) => v[1]),
            4,
        );
        frame.set(
            inverse.map((v) => v[0]),
            8,
        );
        frame[11] = 1 + this.model.top / axes[2];
        frame.set(
            inverse.map((v) => v[1]),
            12,
        );
        frame.set(this.model.sun, 16);
        frame.set(metadata.east, 20);
        frame.set(metadata.north, 24);
        frame.set(metadata.up, 28);
        const integers = new Uint32Array(frame.buffer);
        integers.set([this.viewSteps, this.solarSteps, metadata.height >= this.model.top ? 1 : 0, 0], 32);
        integers.set([this.width, this.rows * 2, this.wavelengths / 3, 0], 36);
        this.frame = frame;
        this.horizon = metadata.horizon;
        this.dirty = true;
        this.skyCursor = 0;
        this.encoded = false;
    }
    /** Encodes at most maxDispatches construction tasks. Submit before calling again.
     * Returns true when readers may be used downstream of this encoder.
     */
    public encode(encoder: GPUCommandEncoder, maxDispatches = 1): boolean {
        this.assertLive();
        if (!Number.isInteger(maxDispatches) || maxDispatches < 1 || maxDispatches > 4096)
            throw new Error("Invalid atmosphere dispatch budget");
        if (!this.camera || !this.frame || !this.horizon) throw new Error("Update a camera before encoding atmosphere");
        if (!this.dirty) return true;
        for (const upload of this.uploads) upload.destroy();
        this.uploads.length = 0;
        const upload = (data: Float32Array, target: GPUBuffer) => {
            const staging = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
            new Float32Array(staging.getMappedRange()).set(data);
            staging.unmap();
            encoder.copyBufferToBuffer(staging, 0, target, 0, data.byteLength);
            this.uploads.push(staging);
        };
        upload(this.frame, this.uniform);
        upload(this.horizon, this.horizonBuffer);
        while (maxDispatches > 0 && this.solarCursor < this.solarUniforms.length) {
            const slice = this.solarCursor++,
                data = this.frame.slice();
            const indices = new Uint32Array(data.buffer);
            indices[34] = Math.floor(slice / 8);
            indices[35] = (slice % 8) * 4;
            upload(data, this.solarUniforms[slice]);
            const pass = encoder.beginComputePass({ label: "Atmosphere solar slice" });
            pass.setPipeline(this.solarPipeline);
            pass.setBindGroup(0, this.solarGroups[slice]);
            pass.dispatchWorkgroups(8, 1, 1);
            pass.end();
            maxDispatches--;
        }
        while (maxDispatches > 0 && this.skyCursor < this.bandUniforms.length) {
            const task = this.skyCursor++,
                data = this.frame.slice(),
                tiles = Math.ceil((this.rows * 2) / 4),
                integers = new Uint32Array(data.buffer);
            integers[39] = Math.floor(task / tiles);
            integers[35] = (task % tiles) * 4;
            upload(data, this.bandUniforms[task]);
            const pass = encoder.beginComputePass({ label: "Atmosphere spectral Sky-View tile" });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this.bandGroups[task]);
            pass.dispatchWorkgroups(Math.ceil(this.width / 8), 1, 1);
            pass.end();
            maxDispatches--;
        }
        this.encoded = this.solarCursor === this.solarUniforms.length && this.skyCursor === this.bandUniforms.length;
        this.dirty = !this.encoded;
        return this.encoded;
    }
    /** Returns stable borrowed resources once encode reports complete construction. */
    public bindings(): IAtmosphereSkyBindings {
        this.assertLive();
        if (!this.encoded) throw new Error("Encode atmosphere before requesting bindings");
        return { ...this.readers };
    }
    /** Destroys owned resources after their last use has been submitted. Idempotent. */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const resource of [...this.resources, ...this.uploads]) resource.destroy();
        this.uploads.length = 0;
        this.resources.length = 0;
    }
}
