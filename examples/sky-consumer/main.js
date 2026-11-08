import { AtmosphereSky } from "@spacexr/atmosphere/webgpu";
import * as spectrum from "@spacexr/atmosphere";
import * as geometry from "@spacexr/atmosphere";
import { displayPipeline } from "./display.js";
try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU is required");
    const device = await adapter.requestDevice();
    device.lost.then((info) => {
        if (info.reason !== "destroyed") {
            document.querySelector("#status").textContent = "GPU lost: " + info.message;
            window.skyError = info.message;
        }
    });
    const canvas = document.querySelector("canvas"),
        context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const scene = spectrum.makePhysicalScene({ planet: "earth", dustTau: 0 }, [0.4, 0.9, 0.1]);
    const sky = await AtmosphereSky.create(device, scene.model, { width: 64, hemisphereRows: 64, viewSteps: 256, solarSteps: 192 });
    let height = 2000,
        yaw = 0,
        pitch = 0,
        display;
    const camera = () => ({
        positionEcefMeters: geometry.geodeticPosition(scene.model.ellipsoid, 0, 0, height),
        forwardEcef: [Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw)],
        rightEcef: [0, Math.sin(yaw), -Math.cos(yaw)],
        upEcef: [Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw)],
        halfWidthTangent: 1,
        halfHeightTangent: canvas.height / canvas.width,
        viewportWidth: canvas.width,
        viewportHeight: canvas.height,
    });
    let pending = false,
        requested = false;
    async function draw() {
        if (pending) {
            requested = true;
            return;
        }
        pending = true;
        try {
            const renderedHeight = height,
                c = camera();
            document.querySelector("#status").textContent = `Building altitude ${renderedHeight} m...`;
            sky.update(c);
            let ready = false;
            while (!ready) {
                const construction = device.createCommandEncoder();
                ready = sky.encode(construction);
                device.queue.submit([construction.finish()]);
                await device.queue.onSubmittedWorkDone();
            }
            const encoder = device.createCommandEncoder();
            display ??= await displayPipeline(device, sky, format);
            display.encode(encoder, context.getCurrentTexture().createView(), c);
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            document.querySelector("#status").textContent =
                `Altitude ${renderedHeight} m. Drag to rotate, W/S to translate, O for orbit, G for ground.`;
            window.skyFrame = (window.skyFrame ?? 0) + 1;
        } finally {
            pending = false;
        }
        if (requested) {
            requested = false;
            await draw();
        }
    }
    canvas.onpointerdown = (e) => canvas.setPointerCapture(e.pointerId);
    canvas.onpointermove = (e) => {
        if (e.buttons) {
            yaw += e.movementX * 0.005;
            pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.005));
            void draw();
        }
    };
    window.onkeydown = (e) => {
        if (e.code === "KeyW") height += 1000;
        else if (e.code === "KeyS") height = Math.max(1, height - 1000);
        else if (e.code === "KeyO") height = 150000;
        else if (e.code === "KeyG") height = 1;
        else return;
        void draw();
    };
    window.addEventListener(
        "pagehide",
        () => {
            display?.dispose();
            sky.dispose();
            device.destroy();
        },
        { once: true },
    );
    await draw();
} catch (error) {
    document.querySelector("#status").textContent = String(error);
    window.skyError = String(error);
    throw error;
}
