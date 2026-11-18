# Releasing the starter kit

The SDK and reference app have one authoritative source in this public
repository. The private Rainwalk API remains the authority for API behavior and
the published contract. Do not maintain a second SDK/example copy elsewhere.

1. Update `CHANGELOG.md` and the root, SDK and reference-app versions together.
   Refresh `package-lock.json` with npm. The app's SDK dependency must match.
2. Run `npm run test:release` and `npm run verify:release`, then review and merge
   the change to `main`.
3. Create and push a tag such as `v0.1.0` at the reviewed main commit. The Release
   workflow checks version/tag agreement and main ancestry, verifies the ZIP
   from a clean installation, and publishes a GitHub release with
   `rainwalk-partner-starter-kit-0.1.0.zip` and its `.sha256` file.
4. Download the release asset and verify the checksum. Update the partner
   portal's explicitly pinned release version when adopting a new release.

The release ZIP contains only the reviewed `release-files.json` allowlist,
plus a generated per-file checksum manifest. Missing or symlinked sources fail
the build. New source files must be deliberately added to the allowlist.

No npm publication is configured yet. Rainwalk will establish npm account/scope
ownership and publishing authentication separately. Until then the app uses
the matching SDK source through the local npm workspace. Do not advertise an
installable npm package or add publishing tokens to this repository.
