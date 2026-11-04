# Releasing

Chaucer uses [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

| Bump | When | Example |
| --- | --- | --- |
| MAJOR | Breaking change: a one-way data migration, a removed feature, a new minimum macOS or Windows | 2.0.0 |
| MINOR | New user-facing feature | 1.1.0 |
| PATCH | Bug fixes and polish only | 1.0.1 |

## When to release

Changes are batched. Day-to-day work goes on a branch and into a pull request; `ci.yml` runs
the tests on Linux and Windows for every PR and every push to `main`. Nothing is built for macOS
or Windows until the batch is a **release candidate**: then merge, and cut one release for the
whole batch. Only version tags run the builds (`release.yml`), so the slow macOS queue is used
once per release.

## Steps

1. Merge the release candidate PR and wait for CI to pass on `main`.
2. Add a section to the top of `CHANGELOG.md`: `## [X.Y.Z] - YYYY-MM-DD`, grouped by area
   (Mail, Compose, Settings, Smart features, Mac, Windows, Fixes), written for users, plus a link line
   at the bottom. This text becomes the GitHub release notes.
3. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then refresh the lockfiles (`npm install --package-lock-only`,
   `cargo update -p chaucer`).
4. Commit (`Release vX.Y.Z`), tag `vX.Y.Z`, push the commit and the tag. CI refuses a tag whose
   version differs from any of the three manifests.
5. The **Release** workflow runs `build-macos` and `build-windows` in parallel, then `publish`
   creates a **draft** release with: the universal dmg, the signed macOS update archive
   (`Chaucer_X.Y.Z_universal.app.tar.gz` + `.sig`), the Windows installer
   (`Chaucer_X.Y.Z_x64-setup.exe` + `.sig`, which is also the Windows update payload) and one
   `latest.json`, using the CHANGELOG section as notes. A build fails if the signing key is
   missing; `publish` fails if the section or any file is missing.
6. Check the draft (notes, assets). In `latest.json` check **all three entries**: `darwin-aarch64`
   and `darwin-x86_64` (the `.app.tar.gz`) and `windows-x86_64` (the `setup.exe`) must report
   `X.Y.Z`, have a non-empty `signature`, and a `url` pointing at that tag. Both installers must be
   named `X.Y.Z`. Then publish it and mark it **Latest**. Installed copies of
   Chaucer read `releases/latest/download/latest.json`, so the update reaches users only once
   the release is published. Don't request asset URLs while the release is still a draft:
   GitHub caches the 404 for a few minutes after publishing, which looks like a broken upload.

The Windows installer is not code-signed (only update-signed), so SmartScreen warns on a manual
install; in-app updates are not affected. The same updater key signs both platforms.

## In-app updates and the signing key

Updates are signed with a minisign key (tauri-plugin-updater). The public key is in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); the private key and its password are the
repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, with a
backup kept outside the repo. **If the private key is lost, installed copies can no longer be
updated**: ship a new public key in a release users install by hand.
