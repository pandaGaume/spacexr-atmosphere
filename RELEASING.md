# Releasing @spacexr/atmosphere

This initial repository prepares an ESM npm package but does not publish it automatically. Runtime dependency `@spacexr/geodesy` is pinned to `0.4.0`.

Before any explicitly requested publication, run `npm ci`, `npm run check`, and `npm pack --dry-run`, review the package contents, update the changelog and version, and verify ownership of the npm scope. Publishing and adding a trusted publisher are separate actions requiring explicit authorization. `prepublishOnly` runs the full verification suite.
