# Releasing

Chaucer uses [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

| Bump | When | Example |
| --- | --- | --- |
| MAJOR | Breaking change: a one-way data migration, a removed feature, a new minimum macOS | 2.0.0 |
| MINOR | New user-facing feature | 1.1.0 |
| PATCH | Bug fixes and polish only | 1.0.1 |

## Steps

1. Add a section to the top of `CHANGELOG.md`: `## [X.Y.Z] - YYYY-MM-DD`, grouped by area
   (Mail, Compose, Settings, Smart features, Mac, Fixes), written for users, plus a link line
   at the bottom. This text becomes the GitHub release notes.
2. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then refresh the lockfiles (`npm install --package-lock-only`,
   `cargo update -p chaucer`).
3. Commit (`Release vX.Y.Z`), tag `vX.Y.Z`, push the commit and the tag.
4. The **Build macOS** workflow builds the universal dmg and creates a **draft** release with
   the dmg attached and the CHANGELOG section as notes. The build fails if the section is missing.
5. Check the draft (notes, asset name), then publish it.
