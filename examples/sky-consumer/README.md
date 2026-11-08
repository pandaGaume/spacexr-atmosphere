# Standalone injected-device sky

This example is outside the research laboratory. It uses only public exports and embedded shaders. The host creates the device, canvas context, display pipeline and command encoders. `display.js` owns exposure and the display transform; `probe.js` is an explicit diagnostic readback helper.

From the package repository:

```sh
npm ci
npm run build
npm pack --ignore-scripts
cd examples/sky-consumer
npm install --ignore-scripts
npm start
```

Open http://127.0.0.1:8098. Drag to rotate, use W/S to change altitude, O for orbit and G for one metre above the ground. Construction finishes for a camera snapshot before the latest queued movement is applied. There is no claim of continuous-motion XR performance. The example shows atmospheric path radiance alone; the dark lower half contains no terrain material.

`npm run test:webgpu` from the repository automates installation into a fresh independent consumer, CPU/GPU comparisons, actual GPU completion, keyboard movement, rotation and the laboratory adapter. It saves `.cache/webgpu-validation.json`, `.cache/sky-consumer.png` and `.cache/lab-public-validation.json`. `CHROME_CHANNEL` selects another installed Playwright browser channel.
