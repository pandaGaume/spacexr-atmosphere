import { defineConfig } from "tsup";
export default defineConfig({
    entry: {
        index: "src/index.ts",
        geometry: "src/geometry.ts",
        model: "src/model.ts",
        scattering: "src/scattering.ts",
        spectrum: "src/spectrum.ts",
        layers: "src/layers.ts",
        composition: "src/composition.ts",
        presets: "src/presets.ts",
    },
    format: ["esm"],
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: ["@spacexr/geodesy"],
});
