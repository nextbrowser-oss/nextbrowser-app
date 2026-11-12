# Linux desktop release assessment

## Current state

The Electron app documents Linux as source-build only in [CONTRIBUTING.md](../CONTRIBUTING.md). [Package configuration](../package.json) has no Linux target and [desktop CI](../.github/workflows/ci.yml) does not cover Linux. The desktop release workflow packages Windows and macOS. Linux CLI and browser artifacts are separate from a Nextbrowser desktop package.

The [CLI archive resolver](../electron/nextctl-archive.cjs) already selects x64 and ARM64 assets. Both are present in [nbc v1.2.39](https://github.com/nextbrowser-oss/nbc_releases/releases/tag/v1.2.39). [ClawBrowser 1.0.11](https://github.com/clawbrowser/clawbrowser/releases/tag/1.0.11) publishes Linux x64 and ARM64 bundles, and the [browser updater](../electron/browser-runtime-updates.cjs) knows their asset names. This establishes artifact availability. Desktop installation, extraction, profile launch and verification still need an end-to-end smoke test.

## First packaging target

Start with an x64 `.deb` on a declared Ubuntu LTS baseline. This gives the initial CI and acceptance work one package format and a known dependency model. Verify dependency installation through `apt`, desktop registration and uninstallation. AppImage would widen the distro test matrix and adds FUSE and desktop-integration cases. Treat it as a separate packaging target. ARM64 CLI and browser archives exist, but desktop ARM64 needs an independent package and smoke run.

| Area | Required validation |
| --- | --- |
| Native module | `node-pty` must load in packaged Electron with its bundled ABI. Run dependency rebuild and [verify-pty.cjs](../scripts/verify-pty.cjs) on the Linux runner, then start a PTY in the installed app. The macOS-specific helper permission fix does not cover Linux packaging. |
| Graphics and desktop | Launch the packaged app in a clean desktop session. Check X11 and Wayland for window controls, clipboard, file dialogs, theme, sizing and suspend/resume. Keep Chromium sandboxing enabled. An Xvfb smoke is useful for CI startup and does not cover Wayland. |
| Sign-in and credentials | Verify account pairing, `nextbrowser://` registration where applicable, and persistence after restart. Check an available desktop keyring and a system without one. Confirm the application's credential storage behavior is explicit in both cases. |
| Browser and CLI | Install or discover nbc, download the supported ClawBrowser bundle, and exercise profile launch, verify, stop and restart. Confirm Camoufox and DasBrowser are offered only where supported. Test dependency and runtime errors on a clean user profile. |
| Updates | Use package-manager upgrades for the first `.deb` rollout and verify settings and sessions survive upgrade and removal. Test that in-app updates give accurate guidance for this package format. |
| Distribution | Build in CI on the declared Linux baseline, archive hashes and a smoke log, then update the download page after an installable artifact passes acceptance. |

This source and artifact inventory completes the research in CLAW-530. Packaging, Linux runtime acceptance and publication belong to CLAW-531.
