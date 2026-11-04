# AGENTS.md, spacexr-atmosphere

## Scope

This repository publishes the renderer-neutral `@spacexr/atmosphere` TypeScript package. Its numerical core depends on exactly `@spacexr/geodesy@0.4.0`. Keep renderer and DOM dependencies out of `src`. The WebGPU research laboratory, shaders, original regressions and recorded artifacts live in `examples/atmosphere-lab`.

## Conventions

- Prefix every TypeScript interface with uppercase `I`.
- Document every public type, property and method with TSDoc/JSDoc.
- State angular units and ECEF axis conventions explicitly. Distances are metres unless an API states otherwise.
- Use the geodesy package for ellipsoids and geodetic conversions, without copying its implementation.
- Never use the em dash character.
- Do not tune optical coefficients to force an expected sky color. Distinguish assumptions, numerical checks and observational validation.

## Verification

Run `npm run check` before handing changes back. It checks formatting, lint, types, builds, runs package and laboratory regressions, and generates TypeDoc documentation. `npm pack --dry-run` verifies the package payload. Do not publish to npm without an explicit request.
