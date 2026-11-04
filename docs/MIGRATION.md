# Migration provenance

Source repository: https://github.com/pandaGaume/SpaceXR

Source branch: `feat/atmosphere-integration`, commit `bde5efe`.

The complete tracked laboratory was copied to `examples/atmosphere-lab`, including experimental octrees, solar 3D LUTs, camera volumes, inside and space WebGPU shaders, native HD presentation, camera reuse experiments, spectral physics, numerical references, documents, images and recorded measurements. The original SpaceXR repository is unchanged.

The physical numerical core is extracted into strict TypeScript under `src`. Laboratory bridge modules import the compiled package so its original regression tests exercise the migrated implementation. Browser imports resolve the installed npm geodesy dependency through a local import map. Generated `dist` and API documentation are excluded from Git as in `@spacexr/geodesy`.

Recorded measurements remain historical artifacts, not claims about the timing of this migration. Scientific calibration against PDS observations has not been performed. Reference image provenance limitations remain documented in the laboratory.
