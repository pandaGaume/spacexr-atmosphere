import { atmosphereSkyWgsl } from "@spacexr/atmosphere/webgpu";
/** Explicit diagnostic readback; not used by the rendering loop. */
export async function probeSky(device, sky, directions) {
    const module = device.createShaderModule({
        code:
            atmosphereSkyWgsl +
            `
 @group(1) @binding(0) var<storage,read> probeDirections:array<vec4f>;
 @group(1) @binding(1) var<storage,read_write> probeResults:array<vec4f>;
 @compute @workgroup_size(1) fn probeMain(@builtin(global_invocation_id) id:vec3u){
  probeResults[id.x]=vec4f(atmosphere_skyRadiance(probeDirections[id.x].xyz),1.0);
 }`,
    });
    const layout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        ],
    });
    const pipeline = await device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [sky.bindings().layout, layout] }),
        compute: { module, entryPoint: "probeMain" },
    });
    const input = device.createBuffer({ size: directions.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
        output = device.createBuffer({ size: directions.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
        staging = device.createBuffer({ size: directions.length * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        device.queue.writeBuffer(input, 0, new Float32Array(directions.flatMap((d) => [...d, 0])));
        const group = device.createBindGroup({
                layout,
                entries: [
                    { binding: 0, resource: { buffer: input } },
                    { binding: 1, resource: { buffer: output } },
                ],
            }),
            encoder = device.createCommandEncoder(),
            pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, sky.bindings().group);
        pass.setBindGroup(1, group);
        pass.dispatchWorkgroups(directions.length);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, staging, 0, directions.length * 16);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        return directions.map((_, i) => Array.from(result.slice(i * 4, i * 4 + 3)));
    } finally {
        input.destroy();
        output.destroy();
        staging.destroy();
    }
}
