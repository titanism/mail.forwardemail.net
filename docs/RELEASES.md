# Release Process (Tauri)

This document outlines the process for creating a new release for the web, desktop, and mobile applications.

## Versioning

We use `np` for version management, which handles version bumping, changelog updates, git tagging, and pushing to the repository.

## Release Steps

1.  **Ensure you are on the `main` branch and your working directory is clean.**

2.  **Run the release script**:

    ```bash
    pnpm release
    ```

    `np` will prompt you to select the version bump (patch, minor, major). Choose the appropriate one.

3.  **Push the tag**: `np` will automatically create and push a git tag (e.g., `v1.2.3`).

4.  **GitHub Actions take over**: Pushing a `v*` tag triggers the release workflows:
    - `release-desktop.yml`: Builds, signs, and notarizes the desktop applications for macOS, Windows, and Linux.
    - `release-mobile.yml`: Builds and signs the mobile applications for Android and iOS.

5.  **Draft Release**: The workflows will automatically create a **draft** GitHub Release and attach all the compiled artifacts (`.dmg`, `.msi`, `.AppImage`, `.apk`, `.ipa`, etc.) to it.

6.  **Publish the Release**: Navigate to the [Releases](https://github.com/forwardemail/mail.forwardemail.net/releases) page on GitHub, review the draft release, edit the release notes if necessary, and then publish it.

## Artifacts

The release process generates the following artifacts:

### Desktop

- **macOS (x64, arm64)**: `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig` (for auto-updater)
- **Windows (x64)**: `.msi`, `.nsis.zip`, `.nsis.zip.sig`
- **Linux (x64)**: `.AppImage`, `.deb`

### Mobile

- **Android**: `.apk` (universal), `.aab` (for Google Play Store)
- **iOS**: `.ipa` (for App Store)

## Code Signing and Notarization

Code signing is handled automatically by the GitHub Actions workflows using secrets stored in the repository.

- **macOS**: Signed with an Apple Developer certificate and notarized by Apple.
- **Windows**: Signed with an EV code signing certificate (optional, via `WINDOWS_CERTIFICATE` secret).
- **Android**: Signed with a JKS keystore.
- **iOS**: Signed with an Apple Distribution certificate and provisioning profile.
- **Tauri Updater**: All desktop bundles are signed with an Ed25519 private key (`TAURI_SIGNING_PRIVATE_KEY`) to generate `.sig` files, which are required for the auto-updater to securely verify new versions.
