# Corporate macOS signing in CI

CLAW-566 uses the existing `prod.keychain` on the corporate Mac mini M2 Pro
10-Core (host/access details are in the internal ticket). The expected identity is
`Developer ID Application: MULTILOGIN OÜ (98Y48GDG5M)`.
The private key stays on that Mac; the workflows do not import/export a P12.

IT must register a dedicated repository runner with labels `self-hosted`,
`macOS`, `ARM64`, and `nextbrowser-macos-signing`. Run it in a dedicated logged-in
macOS user session: the packaging checks launch Electron. Configure that user's
existing keychain for non-interactive codesign access and a working `notarytool`
credential profile. Xcode command-line tools, Node tooling and network access to
Apple/GitHub/npm must be available.

Repository Actions variables:

| Variable | Value |
| --- | --- |
| `MAC_SIGNING_KEYCHAIN` | Absolute path to the existing `prod.keychain` |
| `MAC_NOTARY_KEYCHAIN` | Absolute path to the keychain holding the notarization credential |
| `MAC_NOTARY_PROFILE` | Existing `notarytool` profile name in that keychain |
| `MAC_SIGNING_READY` | Set to `true` only after the runner and keychain/profile are configured |

Provision notarization credentials through the corporate secret-management
process. The repository needs neither the user's Apple account login nor the
keychain password: IT configures access in the runner's user context. The job
does not change keychain search lists, unlock passwords or key access controls.

Both installer workflows use `package-macos.yml`. `Build installers` defaults to
an explicitly ad-hoc test candidate; enable `corporate_signing` for the corporate
runner. `Release` always requires corporate signing. A missing readiness flag
fails before queuing on a self-hosted runner. Windows and macOS builds upload
artifacts first; the single publication job depends on both succeeding and
checks the signed macOS evidence/source/version/checksums before uploading.

`scripts/macos-signing.mjs` verifies the identity/private key with a temporary
signing probe and checks notarization authorization, then builds with
`CSC_KEYCHAIN` and the existing notarization profile. It requires Developer ID
signing, hardened runtime and notarization. Legacy P12/Apple account environment
variables are excluded from the build subprocess.

The signed app is included in both ZIP and DMG. The final DMG is submitted to
Apple and stapled, then both extracted copies of the app are verified against
the same signed code hash/version, Gatekeeper, and stapling checks. DMG stapling
changes its bytes: updater SHA512/size and external blockmaps are regenerated
afterward. `macos-signing-evidence.json` and `macos-SHA256SUMS` describe the final
artifacts. An ad-hoc candidate records `production_ready: false` instead.

Apple's distribution workflow is documented in
[Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
and [Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

Local verification: `node --test scripts/macos-signing.node.mjs` checks signature
rejection, keychain-only environment selection, final updater hashes/blockmaps,
and malformed metadata. These tests do not validate a real certificate or Apple
submission; a corporate-runner signing build and a clean-Mac install/update
check are still required before production readiness.
