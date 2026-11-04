# Layers, composition and rendering contracts

The design is informed by these local spikypanda sources:

- `packages/dev/core/src/sim/scene-state-view.interface.ts`: structural atmosphere aggregator.
- `packages/dev/plugins/physics/src/scene/atmosphere.node.ts`: container dispatch across autonomous layers.
- `packages/dev/plugins/physics/src/scene/atmosphere-layer.node.ts`: layer-local state and `ICompositionView`.
- `packages/dev/plugins/chemistry/src/composition/composition.node.ts`: `ICompositionComponent`.
- `packages/dev/core/src/sim/chemistry.interfaces.ts`: `IGasMetadata`.
- `packages/dev/core/src/sim/particulate.interfaces.ts`: `IParticulateMetadata`.

This package reuses compatible structural data boundaries without importing simulation sessions, graph nodes or plugins. Unlike cabin-wide thermodynamic reporting, rendering samples local spectral extinction and scattering along rays. A volume-weighted global pressure or temperature cannot replace that calculation.

`IAtmosphere` supplies ellipsoid, top, star direction, ordered `IAtmosphereLayer` instances and density sampling. Each layer supplies an altitude profile, its own composition or particle state, and wavelength-specific optical coefficients. The `LayeredAtmosphere` class is a reference implementation, not a required base class.

The spectral CPU integrator loops over arbitrary layers. The laboratory GPU packs up to four profiles and four independent spectral coefficient sets. Its solar texture stores one density column per layer, rejects shadowed interpolation corners, and its Sky-View stores Mie contributions separately per layer so differing particle phases remain distinct. CPU and GPU share metres at the public boundary; GPU profile metadata and coefficients convert to kilometres and inverse kilometres explicitly.

Layers use half-open altitude supports [bottom, top). Multiple overlapping components add local optical coefficients. No automatic global hydrostatic continuity is imposed between independently specified layers. The caller is responsible for physically consistent pressure and density boundary conditions.

Particulate id, display name, aerodynamic diameter, bulk density and PM category are preserved. Only explicit optical particle radius, lognormal width, complex refractive index and number density enter Mie. A composition with a bound particulate and no matching aerosol optical layer is rejected. Unknown molecular species are also rejected unless an optical polarizability is supplied explicitly.

The migrated geodesy boundary uses the npm dependency for forward and inverse conversions. For strongly flattened synthetic ellipsoids, an additional normal-projection refinement uses the dependency's forward conversion and meridional curvature APIs to retain the original laboratory's centimetre-level numerical regression. The geodesy package itself is not modified.

The original five composition presets and four particulate descriptors are exported by `presets` and selectable in the laboratory. Their molecular molar masses and particulate units are retained; no refractive index is inferred from a catalog label. An external IAtmosphere implementation must return density multipliers consistent with its declared analytic layer profiles when used by the GPU adapter.
