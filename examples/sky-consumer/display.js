import { atmosphereSkyWgsl } from "@spacexr/atmosphere/webgpu";
export async function displayPipeline(device, sky, format) {
    const cameraLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    const module = device.createShaderModule({
        code:
            atmosphereSkyWgsl +
            `
 struct DisplayCamera {forward:vec4f,right:vec4f,up:vec4f,screen:vec4f}
 @group(1) @binding(0) var<uniform> displayCamera:DisplayCamera;
 @vertex fn vertexMain(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));return vec4f(p[i],0.0,1.0);
 }
 @fragment fn fragmentMain(@builtin(position) pixel:vec4f)->@location(0) vec4f {
  let uv=pixel.xy/displayCamera.screen.xy;
  let d=normalize(displayCamera.forward.xyz+(2.0*uv.x-1.0)*displayCamera.right.w*displayCamera.right.xyz+(1.0-2.0*uv.y)*displayCamera.up.w*displayCamera.up.xyz);
  let linear=max(vec3f(0.0),atmosphere_skyRadiance(d));let mapped=vec3f(1.0)-exp(-linear*displayCamera.screen.z);
  let encoded=select(1.055*pow(mapped,vec3f(1.0/2.4))-vec3f(0.055),12.92*mapped,mapped<=vec3f(0.0031308));return vec4f(encoded,1.0);
 }`,
    });
    const info = await module.getCompilationInfo();
    if (info.messages.some((m) => m.type === "error")) throw new Error(JSON.stringify(info.messages));
    const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [sky.bindings().layout, cameraLayout] }),
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
    });
    const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: cameraLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
    return {
        encode(encoder, view, camera, exposure = 12) {
            device.queue.writeBuffer(
                uniform,
                0,
                new Float32Array([
                    ...camera.forwardEcef,
                    0,
                    ...camera.rightEcef,
                    camera.halfWidthTangent,
                    ...camera.upEcef,
                    camera.halfHeightTangent,
                    camera.viewportWidth,
                    camera.viewportHeight,
                    exposure,
                    0,
                ]),
            );
            const pass = encoder.beginRenderPass({
                colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, sky.bindings().group);
            pass.setBindGroup(1, group);
            pass.draw(3);
            pass.end();
        },
        dispose() {
            uniform.destroy();
        },
    };
}
