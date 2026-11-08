# WebGPU precision qualification

Status: qualification protocol implemented by `tests/browser/validate.js` and `tests/webgpu-tolerances.json`. The latest local execution writes `.cache/webgpu-validation.json`. A recorded passing run applies to its adapter, browser, quality and listed cases. Read with [the integration contract](WEBGPU-INTEGRATION.md).

## Representation to evaluate

Keep public ECEF positions as JavaScript numbers in metres. Use `@spacexr/geodesy` for CPU geodetic conversion, local reference altitude and ellipsoid metadata. The implementation splits each scaled ECEF origin component and reciprocal axis into float32 high and residual low parts. Compensated products and sums retain this information through ray/ellipsoid intersections and the ellipsoid implicit residual. Altitude uses a stable normal-line intersection, an approximation to geodetic distance whose error is checked at the listed positions. It is not a replacement for the CPU geodesy implementation.

A split is only a storage representation. Adding `high + low + relative` into one large float32 position before computing altitude or intersection loses the information again and is not acceptable evidence of precision. Test the complete GPU altitude, intersection, shadow and integration path. Compare the candidate against the historical ECEF-kilometre float32 path under identical quadrature and formats to distinguish coordinate errors from LUT and integration errors. If the candidate fails, revise the geometric formulation before increasing tolerances.

The first acceptance domain is Earth WGS84 and the existing Mars axes, with cameras from the ellipsoid surface through 1,000 km geodetic altitude. Additional shapes, greater distances and profile configurations may be supported only with separately recorded qualification. The runtime's input range and documentation must match the domain actually qualified.

## Independent reference

Use the public double-precision CPU `integrateSpectral` path with direct solar integration. No GPU LUT, shader-generated reference or cached GPU result may feed the reference. CPU input geometry, source spectrum, wavelength bins, phase functions and normalization must match the candidate.

Start from 256 view steps and 96 solar steps, then double each independently and jointly. Continue until reference variation is at most one quarter of the chosen absolute acceptance tolerance, with relative stability also recorded for nonzero signals. Failure to converge is a failed or unresolved case, never a passing GPU comparison. Save quadrature counts and residuals per case.

CPU double precision alone is not proof that a geometrically degenerate ray is well classified. Exact tangent and boundary cases must include analytic intersection checks or bracketing rays on either side. Record the expected hit/miss regime independently of the GPU.

## Required case matrix

| Dimension       | Required samples                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Body            | WGS84 Earth; existing Mars ellipsoid                                                                      |
| Camera latitude | Equator, mid-latitude, both poles                                                                         |
| Camera altitude | 0 m, 1 m, 100 m, 10 km, top minus 1 m, top, top plus 1 m, 1,000 km                                        |
| Solar geometry  | Day, grazing illumination, terminator, night                                                              |
| Direction       | Zenith, nadir, exact tangent, rays on both sides of the horizon, sunward and antisolar                    |
| Movement        | Rotation only; 64 mm stereo offset; horizontal and vertical translations; both regime-crossing directions |
| Medium          | Representative one-to-four-layer gas/aerosol cases, sharp layer boundaries, zero-density layer            |
| Spectrum        | 24 and 48 wavelengths; blackbody plus an experimental narrow-band source                                  |

Generate ray offsets from the actual horizon geometry, not only from a screen grid that could miss the limbe. Include rays missing the atmosphere and ground-blocked sunlight. The zero-density case must have zero scattered radiance and unit transmission along unblocked paths. Exact surface rays must not spuriously integrate inside the opaque ellipsoid.

## Float32 directions and exact tangency

The frozen budget includes `2e-7` radians for a normalized float32 direction. At exact tangency, an opaque ellipsoid produces different limiting radiances on its two sides. Compare the GPU result to independently integrated CPU bounds at the central direction and both angular offsets. Report the raw central-direction error as `pointError` and the distance outside this envelope as the acceptance error. Bracketing rays at `+/- 2e-4` radians retain the ordinary pointwise tolerance; they cannot use the tangent envelope.

Sky construction evaluates both tangent limits explicitly. Tiny negative geometric heights caused by rounding only in these limit texels are projected to one millimetre above the ellipsoid before evaluating density and sunlight. This correction is not applied to ordinary ray integration. The reader uses the same direction-uncertainty band when sampling the limit texels.

## Error budget and pass criteria

Before marking any GPU implementation qualified, commit a machine-readable tolerance manifest beside the tests. Every case refers to a named tolerance profile. The manifest records:

- altitude error in metres, intersection-distance error in metres and expected visibility classification;
- maximum absolute spectral transmittance error, evaluated independently from the RGB reconstruction;
- maximum and RMS scene-linear RGB radiance errors;
- relative radiance error only above an explicit reference-signal floor;
- absolute error for near-zero reference signals;
- wavelength count, source normalization, LUT sizes, integration steps and texture formats;
- rationale for each threshold, including CPU convergence and the intended rendering error budget.

The committed manifest fixes maximum absolute radiance error at 0.002 reference-solar-normalized units, spectral solar transmission error at 0.002, and relative radiance error at 5% above signal magnitude 0.04. Reference convergence must be at most 0.0005. Camera altitude tolerance is 0.01 m below 10 km and 1 m from 10 km upward; non-tangent ground intersections have a 1 m tolerance. Derive thresholds from a stated output error budget before evaluating the candidate; do not copy the historical 0.014 transmittance discrepancy as an acceptable limit or tune thresholds to make a run pass. Changing these thresholds requires a new stated rendering budget, not merely a failing candidate. The latest report records central and envelope errors separately.

Report direct-integration GPU error, solar-LUT error, Sky-View interpolation error and texture-quantization error separately where possible. Passing a frame-average metric must not conceal a failed tangent, shadow or ground case. All outputs must be finite; spectral transmission must remain in its physical range within the declared numerical tolerance. Scene-linear RGB radiance is compared before display gamut clipping.

## Harness and evidence

The browser harness uses only the packed public entry and embedded shader modules. It runs in headless Chrome with WebGPU explicitly available. Missing WebGPU is a failed required CI job, not a skipped successful validation. Capture shader compilation errors, device loss and uncaptured GPU validation errors as test failures.

Batch diagnostic readbacks outside the production frame API. Record browser/version, adapter/backend information when exposed, device limits, case inputs, tolerance profile, CPU convergence, maximum-error ray and summaries in a machine-readable artifact. Hardware timings are separate diagnostics and are not precision thresholds.

Also verify submission ordering, abandoned-initialization behavior, two distinct views encoded before one submission, invalid input, partial-creation cleanup, repeated disposal, viewport changes and recreation after device loss where the harness permits deterministic loss injection. The two-view test must compare each eye against its own independent reference.

Existing `WEBGPU-VALIDATION.json` results remain historical evidence, not an acceptance manifest for this protocol. Numerical agreement is separate from observational validation and XR performance qualification.

## Current automation

The default suite contains 28 body/camera/medium configurations, 56 views and 392 paired-eye radiance probes. It covers Earth and Mars, equator and both poles, 0 m through 1,000 km, day/terminator/night, one to four layers, 24/48 wavelengths, a Gaussian incident spectrum, zero density, both sides of regime crossings and the horizon. Per-case source and quality metadata are retained. The suite also checks live-renderer device loss and disposal.

The packed consumer is installed into a fresh directory for each run, and its entry is compared byte-for-byte with the current build. Its root declarations compile with ES2022 alone; the WebGPU declarations compile with ES2022 plus DOM and the distributed WebGPU type dependency. Chrome then exercises ground/orbit translations and rotation, followed by the laboratory's public spectral path and native PNG export.

Run `npm run test:webgpu` after installing Chrome (or `npx playwright install chrome`). `CHROME_CHANNEL=chromium` selects a Playwright-installed Chromium; the default is Chrome. No browser test is silently skipped when an adapter is unavailable. The CI definition is `.github/workflows/webgpu.yml`; a local passing result does not assert that the remote job has already run.

Arbitrary layer discontinuities, very narrow custom profiles, other ellipsoids and different quality settings still require case-specific convergence and error measurements. No universal precision guarantee is inferred from these representative cases.

The [recorded local qualification summary](research/WEBGPU-SKY-VALIDATION.json) retains the adapter, entry hash, quality, budgets and case maxima. Direct solar transmission probes cover the first wavelength triple; radiance probes integrate all wavelength bins. The complete per-ray report stays in `.cache/webgpu-validation.json` and in the CI artifact when that job runs.
