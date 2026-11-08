# @spacexr/atmosphere

Renderer-neutral TypeScript physics for ellipsoidal atmospheres, stratified layers and spectral scattering. Runtime geodesy comes from exactly `@spacexr/geodesy@0.4.0` on npm. Package structure and tooling follow [geodesy_ts](https://github.com/pandaGaume/geodesy_ts).

## Install and verify

```sh
npm ci
npm run check
npm pack --dry-run
npm start
```

The laboratory opens at http://127.0.0.1:8097/ by default. The original SpaceXR laboratory may still be running on port 8096. Set `PORT` to choose another port. This repository is not yet published to npm; `npm pack` builds a local distributable.

## Architecture

- `src`: strict TypeScript numerical core, ESM, no DOM, WebGPU or Babylon dependency.
- `webgpu`: separate injected-device spectral sky renderer, typed API and embedded shader build.
- `tests`: package, layered-interface and composition interoperability tests.
- `examples/atmosphere-lab`: the complete migrated WebGPU laboratory, including original octree, LUT, camera-volume and spectral experiments, shaders, recorded measurements and images.
- `docs/api`: generated TypeDoc output, excluded from Git.
- `dist`: ESM and declaration outputs, excluded from Git.

Exports: package root, `geometry`, `model`, `scattering`, `spectrum`, `layers`, `composition`, `presets`, `webgpu`, and `package.json`. Root `model.Atmosphere` preserves the historical two-profile API for regression comparisons; the spectral laboratory consumes the structural `IAtmosphere` layer contract.

## Layered atmosphere

```ts
import { Ellipsoid } from "@spacexr/geodesy";
import { createAtmosphereLayer, compositionFromMixture, LayeredAtmosphere, makeSpectralScene, type IAtmosphere } from "@spacexr/atmosphere";

const gas = createAtmosphereLayer({
    id: "lower-air",
    kind: "gas",
    profile: {
        kind: "exponential",
        bottomAltitudeMeters: 0,
        topAltitudeMeters: 100000,
        referenceAltitudeMeters: 0,
        scaleHeightMeters: 8400,
        densityScale: 1,
    },
    gas: {
        composition: compositionFromMixture({ N2: 78, O2: 21, Ar: 1 }, 101325),
        pressurePa: 101325,
        temperatureK: 288,
        gravity: 9.80665,
    },
});

const atmosphere: IAtmosphere = new LayeredAtmosphere({
    ellipsoid: Ellipsoid.WGS84,
    top: 100000,
    sun: [0.02, 1, 0],
    layers: [gas],
});
const scene = makeSpectralScene(atmosphere, { wavelengths: 24 });
```

`IAtmosphere` and `IAtmosphereLayer` are structural contracts. Callers can supply their own implementations without inheriting these classes. Each layer owns its profile and its gas or particulate state. Overlapping layers add local optical coefficients. The CPU integrates an arbitrary number of layers; this first laboratory GPU adapter accepts one to four analytic layers and rejects larger sets explicitly.

Profiles use geodetic metres above the ellipsoid, with exponential, constant and Gaussian shapes. ECEF uses X at longitude 0 and latitude 0, Y at longitude 90 degrees east, Z at the north pole. Geodetic APIs state degrees or radians explicitly. Array directions are dimensionless unit vectors; coordinate arrays contain metres.

## Compositions and particles from spikypanda

The public `IGasMetadata`, `ICompositionComponent`, `ICompositionView` and `IParticulateMetadata` shapes follow the local spikypanda contracts. They do not import its graph, editor, plugins or session runtime. Composition components retain species ids, molar fractions, SI molar masses and optional graph provenance; composition snapshots retain reference pressure and bound particulate metadata.

Composition summaries are not averaged across custom layers; the report retains each layer's actual state.

N2, O2, CO2, Ar and H2O have static molecular polarizability data. Other species require an explicit optical registry, rather than an invented spectral behavior. A particulate's aerodynamic diameter and material density alone do not determine Mie scattering: optical geometric radius, size distribution, complex refractive index and number concentration must be provided. PM category and display name never select a color. Particulates referenced by a composition require matching optical aerosol layers and cannot be silently discarded.

The original five `COMPOSITION_PRESETS` and four `PARTICULATE_PRESETS` descriptors are exported as immutable data and selectable in the laboratory.

In the laboratory, open **Couches IAtmosphere, compositions et particules**, generate the default layer definitions, edit their JSON, or add an experimental high-altitude dust layer. Enable the layer definitions and click **Rendu HD**. The report records each layer's actual state. The older RGB comparisons remain under their separate historical mode.

## Scientific and performance limits

Spectral single scattering uses Planck or an experimental Gaussian source, molecular polarizability, homogeneous-sphere Mie, independent density profiles and CIE XYZ to sRGB conversion. There is no planet-dependent target sky color. No multiple scattering, molecular absorption lines, polarization, non-spherical particles or observational PDS calibration is implemented. Default dust optical properties are experimental assumptions.

Historical images and timings remain under the laboratory's `outputs` directory. They predate parts of this migration and do not measure the new general layered pipeline. Sky-View rebuild cost and cached HD display cost must be reported separately. The layer GPU ABI packs 304 bytes per wavelength triple and retains separate Mie radiance per atmospheric layer; it must not be mixed with the historical 112-byte ABI.

See [migration provenance](docs/MIGRATION.md), [layer design](docs/LAYERS.md), the laboratory's [spectral notes](examples/atmosphere-lab/SPECTRAL.md), and the [integration brief](docs/INTEGRATION.md), in French, on what keeps the renderer inside the laboratory.

## WebGPU sky rendering

`@spacexr/atmosphere/webgpu` exports `AtmosphereSky`, `atmosphereSkyWgsl` and typed camera, quality and binding contracts. It borrows the host's device and encoder; the host owns submission, canvas, drawing and display transforms. Use one instance per view or XR eye. The CPU root entry remains free of DOM and WebGPU runtime requirements.

```ts
import { AtmosphereSky } from "@spacexr/atmosphere/webgpu";

const sky = await AtmosphereSky.create(device, atmosphere);
sky.update(camera);
const encoder = device.createCommandEncoder();
const ready = sky.encode(encoder);
if (ready) {
    const { layout, group } = sky.bindings();
    // Use layout in the host pipeline; bind group 0 in a later render pass.
}
device.queue.submit([encoder.finish()]);
// Repeat encode on submitted encoders until ready, then draw as needed.
// Call sky.dispose() after the last submission using this instance.
```

Construction is progressive and restarts the view tasks after translation. Rotation reuses the full-sky cache. Changing atmosphere, sunlight, source spectrum or quality requires a replacement instance. The WGSL reader returns scene-linear spectral sky radiance without an invented ground color, stellar disk, exposure or tone mapping. Terrain aerial perspective belongs to the next milestone.

See the [integration contract](docs/WEBGPU-INTEGRATION.md), [precision protocol](docs/WEBGPU-PRECISION.md) and [standalone consumer](examples/sky-consumer/README.md). Run `npm run test:webgpu` for the packed-consumer Chrome suite. Reconstruction cost and XR frame rates are not qualified by numerical agreement.
