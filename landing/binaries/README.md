# Static Binaries for the Landing Page

This folder contains files that are served **directly** from the landing page.

## Android Wallet

Place the built Android APK here:

```
landing/binaries/dai-miner-wallet.apk
```

Once the file is here:

- The "Download Android Wallet (.apk)" button on the landing will link to it relatively.
- It will work when:
  - Running locally: `npm run serve:landing` (or the node script)
  - Deployed via `./scripts/deploy-landing.sh`
  - Published to IPFS via `./scripts/publish-to-ipfs.sh`

## How to build the APK (DAI Wallet with branding + full i18n + src/ structure)

From the `dev/wallet` directory (sibling of this `dev/node` repo):

```bash
cd ../wallet
npm run release:apk
```

This runs `eas build --platform android --profile preview --local` with the
Android SDK path it actually needs, and writes the finished apk straight to
`landing/binaries/dai-miner-wallet.apk` in this repo — no expo.dev upload, so
there's no EAS artifact-retention window for it to expire out from under the
download link. See `dev/wallet/scripts/release-apk.sh` for details/overrides.

Bump the `?v=` cache-busting query in `landing/wallet/index.html` and
`landing/miner.html` if the build's actual content changed, then deploy:
`./scripts/deploy-landing.sh` (or `publish-to-ipfs.sh`).

`eas.json`'s `preview` profile is what makes it a sideloadable `.apk` instead
of a Play-Store `.aab`; `app.json` + `assets/icon.png` etc. set the "DAI
Wallet" name/logo.

### Old flow (EAS cloud build) — avoid, artifacts expire

```bash
cd ../wallet
npm run build:android          # uploads to EAS; produces a preview .apk
# Download the .apk from the EAS dashboard before it expires, then:
#   cp ~/Downloads/build-*.apk landing/binaries/dai-miner-wallet.apk
```

This is the reason the apk has gone missing before: expo.dev deletes build
artifacts after its retention window, and nothing re-copies a fresh one
automatically. Prefer `npm run release:apk` above.

### Raw gradle (if you want to skip the eas-cli wrapper entirely)
```bash
npm run prebuild
cd android
./gradlew assembleRelease   # or assembleDebug
# then find the .apk under app/build/outputs/...
```
Copy/rename it into `landing/binaries/dai-miner-wallet.apk` so that
`publish-to-ipfs.sh` and `deploy-landing.sh` will include it.

## Other files

You can also drop other static assets here (future Windows/Mac installers, etc.) if you want one-click downloads served directly from the landing without external links.