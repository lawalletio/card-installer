# LaWallet Boltcard Installer

Android app to provision and wipe **NTAG424 DNA** NFC cards as Boltcards for a
[LaWallet](https://lawallet.io) / [Boltcard](https://boltcard.org) server. Tap a
blank card to write its keys and `lnurlw`, or tap a programmed card to wipe it — a
contactless, paywave-like experience for the Lightning Network.

> This is the [**lawalletio**](https://github.com/lawalletio/card-installer)
> fork of [boltcard/bolt-nfc-android-app](https://github.com/boltcard/bolt-nfc-android-app),
> with LaWallet integration, instance-aware QR-JWT login, a bulk-provisioning flow,
> tap-to-wipe, and **license-free native NFC**.

Android only.

## Current version

**v0.3.0** — see the [latest release](https://github.com/lawalletio/card-installer/releases/latest).

## What's different in this fork

- **No NXP TapLinX license required.** Every NTAG424 operation (authentication,
  key change, file settings, wipe, verification) runs in JavaScript via
  [`react-native-nfc-manager`](https://github.com/revtel/react-native-nfc-manager)
  + AES/CMAC (`crypto-js`). The app never registers TapLinX, so there's no
  "TapLinX registration failed — provide a valid license" wall.
- **Instance-aware login** via a QR-encoded device JWT — scan the token from your
  LaWallet admin to authenticate against a specific server instance.
- **Bulk Create** — pick a card design, then tap blank cards one after another to
  provision them; an animated progress ring fills clockwise through each write step.
- **Tap-to-wipe** — tap a programmed card to read its UID, fetch its keys, wipe them
  to zero over NFC, and delete the card server-side.
- **Read NFC** — inspect any card's NDEF / `lnurlw`.

## NFC card support

- NXP NTAG424 DNA
- NXP NTAG424 DNA TT (Tag Tamper)

## Install

Download the APK from the
[latest release](https://github.com/lawalletio/card-installer/releases/latest)
and install it on your Android phone.

> ⚠️ Release APKs are currently **signed with the debug key** (the production
> upload keystore is not committed to this repo). They install on any device but
> are **not** Play-Store-grade. See [Releasing](#releasing-a-build) below.

## Pinned toolchain

This project is locked to a specific build toolchain. Versions are declared in repo
config and consumed automatically by the helper scripts — no manual env-var juggling.

| Tool                  | Version             | Source of truth                                    |
| --------------------- | ------------------- | -------------------------------------------------- |
| Java                  | Zulu 11.0.26        | `.sdkmanrc`                                        |
| Node                  | 18.15               | `.nvmrc`, `.node-version`                          |
| Yarn                  | 1.x (classic)       | installed by `scripts/setup.sh`                    |
| Gradle                | 7.5.1               | `android/gradle/wrapper/gradle-wrapper.properties` |
| Android Gradle Plugin | 7.3.1               | `android/build.gradle`                             |
| Kotlin                | 1.7.0               | `android/gradle.properties`                        |
| Android SDK           | API 33 (Android 13) | `android/build.gradle`                             |
| Min SDK               | API 23 (Android 6)  | `android/build.gradle`                             |
| Build Tools           | 33.0.0              | `android/build.gradle`                             |
| NDK                   | 23.1.7779620        | `android/build.gradle`                             |

Bumping any of these is a deliberate change — they're committed to git and shared
across machines.

## Build optimization

The release build targets **real ARM hardware only** —
`reactNativeArchitectures=armeabi-v7a,arm64-v8a` in `android/gradle.properties` —
dropping the `x86`/`x86_64` emulator ABIs. This installs on the 32-bit
`armeabi-v7a` deployment device (the Z92 NFC handheld) **and** modern 64-bit phones,
cutting the release APK from ~91 MB to ~53 MB. Hermes is enabled. To build for an
x86 emulator, override the ABI on the command line:

```bash
./gradlew assembleRelease -PreactNativeArchitectures=x86_64
```

> The split is enforced with `ndk { abiFilters }` on the app module **and** on
> `react-native-vision-camera` (in the root `subprojects` block) — with ABI splits
> disabled, library CMake modules don't otherwise honor `reactNativeArchitectures`,
> and a mismatch makes vision-camera fail to find reanimated's prefab (`CXX1210`).

## Quick start

### One-shot setup (new machine)

Requires Android Studio + Android SDK installed separately
(see https://reactnative.dev/docs/environment-setup → "React Native CLI Quickstart").

```bash
git clone <repo>
cd card-installer
yarn setup       # installs SDKMAN, nvm, Zulu 11, Node 18.15, yarn, JS deps
```

The setup script is idempotent — safe to re-run after pulling changes.

After setup:
1. `cp .env-example .env` and fill in any required values. (The native NFC path no
   longer needs an NXP `MIFARE_KEY`.)
2. Connect an Android device with USB debugging enabled, or start an emulator.
3. Build & run (see commands below).

### Day-to-day commands

```bash
yarn build:debug     # build debug APK (no install)
yarn build:release   # build signed release APK (arm64-v8a)
yarn build:bundle    # build AAB for Google Play
yarn android         # build + install debug on connected device/emulator
yarn start           # start Metro bundler
yarn clean           # gradle clean
yarn clean:full      # nuke gradle daemons + local caches (use after JDK changes)
```

All build commands route through `./scripts/build`, which sets `JAVA_HOME` to a
JDK 11 install automatically (via SDKMAN, then macOS `java_home`, then known
Linux JDK paths). You don't need to set `JAVA_HOME` manually.

### Releasing a build

The release `signingConfig` uses the upload keystore at
`android/app/my-upload-key.keystore` when present, and **falls back to the debug key**
when it isn't (so test builds still sign and install). For a production-grade build:

1. Place your upload keystore at `android/app/my-upload-key.keystore`. Keep its
   credentials **out of committed files** — put them in `~/.gradle/gradle.properties`
   or environment variables.
2. `yarn build:bundle` → `android/app/build/outputs/bundle/release/app-release.aab`
3. Upload the AAB to the Google Play Console.

First-time keystore generation:
```bash
keytool -genkeypair -v -keystore android/app/my-upload-key.keystore \
  -alias onesandzeros-key -keyalg RSA -keysize 2048 -validity 10000
```

### Manual setup (if you don't want `yarn setup`)

<details>
<summary>Click to expand</summary>

1. Install Android Studio + Android 13 (API 33) SDK, build-tools 33.0.0, NDK 23.1.7779620
2. Install SDKMAN: `curl -s https://get.sdkman.io | bash`
3. In the repo root, run `sdk env install` (reads `.sdkmanrc`, installs Zulu 11)
4. Install nvm: https://github.com/nvm-sh/nvm
5. In the repo root, run `nvm install` (reads `.nvmrc`, installs Node 18.15)
6. `npm install -g yarn`
7. `yarn install`
8. `cp .env-example .env`
9. Connect a device or start an emulator
10. `yarn android`

</details>

## Usage

1. **Login** — on the Login tab, scan the QR-encoded device token from your LaWallet
   admin. This authenticates the app against that server instance.
2. **Bulk Create** — pick a card design, tap **Tap Card to Write**, then hold a blank
   NTAG424 card to the phone. The progress ring fills clockwise as the keys and
   `lnurlw` are written and verified. Provision more cards by tapping them in turn.
3. **Wipe Card** — tap a programmed card; the app reads its UID, fetches the reset
   keys from the server's `/api/cards/:id/wipe` endpoint (which also **unpairs** the
   card from its user), wipes all keys to zero over NFC, clears the NDEF, and deletes
   the card server-side.
4. **Read NFC** — tap any card to inspect its `lnurlw` URL and PICC/CMAC parameters.

> ⚠️ Writing/wiping is destructive. If you lose a card's keys you may be unable to
> reprogram it. Do not move the card until an operation completes.

## Security

- NTAG424 keys are generated and held by your LaWallet / Boltcard server. Regular
  card reads (`GET /api/cards/:id`) never expose them — the app fetches keys only
  from the dedicated `/write` (program) and `/wipe` (reset) endpoints, each of which
  **unpairs** the card from its user as a side effect of exporting its keys.
- Keep your keys secret and avoid other listening NFC devices in range while writing.
- Do **not** commit signing credentials. If real keystore passwords were ever
  committed to `android/gradle.properties`, rotate them and move the values to
  `~/.gradle/gradle.properties` or environment variables.

## Version history

### 0.3.0
License-free native NFC (TapLinX no longer registered); write progress ring that
fills clockwise with a success animation; tap-to-wipe flow; instance-aware QR-JWT
login; bulk provisioning; NFC read/write UX overhaul; Android 16 / Pixel 9 startup &
camera fixes.

### 0.1.9
Various fixes to attempt to prevent card programming errors.

### 0.1.4
Added support for random UID to increase privacy.

## License

[MIT](LICENSE). This is a fork of
[boltcard/bolt-nfc-android-app](https://github.com/boltcard/bolt-nfc-android-app)
(also MIT); the original copyright is retained in the LICENSE alongside the fork's.

## More

- [Card programming errors](card-programming-errors.md)
- [Testing](testing.md)
