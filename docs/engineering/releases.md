# Release channels

The [release-cos workflow](../../.github/workflows/release-cos.yml) builds and distributes Nightly prereleases and Stable releases.

## Nightly

A push of a tag named `dev-vX.Y.Z.<suffix>` triggers the workflow. The tag can be lightweight or annotated. For manual dispatch, pass the existing tag as the `version` input and select a ref whose commit matches the tag. The workflow checks that the tag resolves to the run's `GITHUB_SHA` and verifies the release lineage.

Automated maintenance uses timestamped lightweight tags on commits already merged to `main` after `cz-test` passes at the exact commit. Choose a version newer than the one currently published on the Nightly channel.

GitHub marks the release as a prerelease. Nightly publishes to its own channel and leaves the Stable pointer, default installer, and npm publication unchanged. After the workflow succeeds, verify the versioned COS manifest, the installer's `--version` path, and the archive SHA-256.

## Stable

Stable releases use `vX.Y.Z` and follow the authorized manual release process. The workflow builds for multiple platforms, publishes to COS and npm, updates the default installation channel, and creates a GitHub Release.
