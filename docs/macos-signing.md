# macOS signing

There are two ways to ship a Developer ID signed, notarized NextBrowser for macOS.

## 1. In CI (key stored as GitHub secrets)

`release.yml` and `build-installers.yml` already sign and notarize through
electron-builder when these repository secrets are set. Without them the
build falls back to an ad-hoc signature, which is what releases have shipped with so far.

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the Developer ID Application `.p12` (`base64 -i cert.p12`) |
| `MAC_CSC_KEY_PASSWORD` | password of that `.p12` |
| `MAC_IDENTITY` | `Developer ID Application: NAME (TEAMID)` |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password of that account |
| `APPLE_TEAM_ID` | Apple team ID |

## 2. Remote signing (key never leaves the signer machine)

This is the approach clawbrowser uses. `scripts/sign_macos_remote.sh` re-signs
an already built app with [rcodesign](https://github.com/indygreg/apple-platform-rs)
remote signing: this machine holds the app, the signer holds the `.p12`, and
rcodesign relays the signing session between them, end-to-end encrypted. It runs on
macOS or Linux.

One-time setup:

```sh
# both machines
cargo install apple-codesign            # provides `rcodesign`
# signer: put the .p12 and a file with its password somewhere private
# this machine: App Store Connect API key for notarization
rcodesign encode-app-store-connect-api-key -o asc-key.json <issuer-id> <key-id> AuthKey_<key-id>.p8
```

Sign a release (CI artifact or `npm run dist:mac` output):

```sh
gh release download v0.2.69 -p 'NextBrowser-*-arm64.zip' -p latest-mac.yml -D release
scripts/sign_macos_remote.sh \
  --input release/NextBrowser-0.2.69-arm64.zip \
  --latest-yml release/latest-mac.yml \
  --signer signer@mac-mini \
  --signer-p12 ~/keys/developer-id.p12 \
  --signer-p12-password-file ~/keys/developer-id.pass \
  --api-key-file asc-key.json
gh release upload v0.2.69 release/NextBrowser-0.2.69-arm64.zip release/latest-mac.yml --clobber
gh release delete-asset v0.2.69 NextBrowser-0.2.69-arm64.zip.blockmap   # stale after re-signing
```

The script applies hardened runtime and `build/entitlements.mac.plist` to the app,
every Electron helper and every loose Mach-O (the node-pty `spawn-helper`, `.node` addons),
just as electron-builder's `entitlements`/`entitlementsInherit` do. It then checks the
result, notarizes and staples the app, re-zips it and rewrites the zip's
`sha512`/`size` in `latest-mac.yml` so auto-update still verifies.

The DMG is not re-signed: it still contains the ad-hoc app. Either publish only the zip
or rebuild the DMG on a Mac from the signed app.
