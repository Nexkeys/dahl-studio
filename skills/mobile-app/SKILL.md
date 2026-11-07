---
name: mobile-app
description: Builds or changes a mobile app with Expo (React Native) on Windows. Runs it in the web preview or the Android emulator and verifies with expo-doctor, type checks, tests and a screenshot. Says plainly that iOS needs EAS cloud builds or Expo Go on a real iPhone. Use when the user wants an Android or iOS app.
argument-hint: "<what the app should do, or the change to make>"
compatibility: "Needs Node.js LTS. The Android emulator needs the Android SDK and an AVD; local native builds also need Java 17. iOS only through Expo EAS cloud builds or Expo Go on a physical iPhone."
metadata:
  dahl-mode: build
  dahl-icon: smartphone
---

# Build a mobile app with Expo

Task: $ARGUMENTS

If the task is empty, ask with `ask_user` what the app should do, or which screen to change in the existing app.

## When to use
- "Make me an app for my phone", "Android app", "iPhone app", "React Native", "Expo".
- Adding or changing screens, navigation or features in an existing Expo or React Native project.

## When not to use
- A website or web app: use `ui` (marketing pages: `landing-page`); putting it online: `deploy-web`.
- The app's backend: use `supabase-backend` or `rest-endpoint`.
- An accessibility pass over the app's screens: use `accessibility-audit`.
- Upgrading the Expo SDK or other dependencies: use `dependency-upgrade`.
- A native Swift or Xcode project: it cannot be built on Windows. Say so and offer Expo.

## Platform facts (state them plainly when they matter)
- **Android:** the emulator runs on Windows with the Android SDK and an AVD (created in Android Studio, Device Manager). Expo Go on the emulator needs no Java; local native builds (`npx expo run:android`) also need Java 17.
- **iOS:** cannot be built or run on Windows, and there is no iOS simulator. Two options: Expo Go on a physical iPhone (`npx expo start`, scan the QR code with the iPhone camera; same Wi-Fi, or `--tunnel` otherwise), or EAS cloud builds (`npx eas-cli build -p ios`) with an Expo account and a paid Apple Developer account. The user runs `npx eas-cli login` themselves.
- **Web preview:** `npx expo start --web` renders in the Preview pane. Good for layout and logic; native modules (camera, sensors, secure storage) behave differently or not at all.

## Mode
Needs Build mode (creates files, installs packages, runs the emulator). In Plan or Review mode, read the project, give the screen and component plan, the commands you would run and what will and will not be possible on this PC, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: environment, project, implement, run, verify.
2. Environment: read "This PC" in your instructions (Node, Java, Android SDK, adb).
   - No Node: `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`.
   - Android SDK is usually at `$env:LOCALAPPDATA\Android\Sdk`. If `adb` is not on PATH, call `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`.
   - Emulators: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds`. No SDK or no AVD: tell the user to install Android Studio and create a device in Device Manager; meanwhile use the web preview.
3. Project:
   - New: `npx --yes create-expo-app@latest my-app --template default --yes` (or `--template blank-typescript` for a minimal start; the folder must not exist). Each `run_command` starts in the project root, so prefix later commands with `Set-Location my-app;`.
   - Existing: `read_file` `package.json` (expo version, scripts), `app.json` or `app.config.ts`, and the routing: an `app/` folder means expo-router (`app/(tabs)/index.tsx`), otherwise `App.tsx`.
4. Implement with `write_file` and `edit_file`, following the project's patterns: React Native components (`View`, `Text`, `Pressable`, `FlatList`, `TextInput`, `StyleSheet`), never HTML elements. Add libraries with `npx expo install <package>` (it picks versions that match the SDK), not plain `npm install`. Anything in `EXPO_PUBLIC_` variables ships inside the app: never put secrets there.
5. Web preview: needs `react-dom` and `react-native-web` (`npx expo install react-dom react-native-web`). `npx expo start` never exits, so start it in the background: `Start-Process -WindowStyle Hidden -FilePath npx.cmd -ArgumentList 'expo','start','--web','--port','8081'`, then poll `(Invoke-WebRequest http://localhost:8081 -UseBasicParsing).StatusCode` until 200. The Preview pane opens `http://localhost:8081`. A bundle check without a server: `npx expo export --platform web` (writes `dist/`).
6. Android emulator:
   - Start the AVD if none is running: `Start-Process "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -ArgumentList '-avd','<name>'`, then `adb wait-for-device` and `adb shell getprop sys.boot_completed` until it prints 1 (`timeout_seconds` 300).
   - Start Expo in the background: `Start-Process -WindowStyle Hidden -FilePath npx.cmd -ArgumentList 'expo','start','--android'`. It installs Expo Go on the emulator and opens the app.
   - Projects with custom native code need a development build: `npx expo run:android` (Java 17 required).
7. iOS requests: explain the options from Platform facts and offer the web preview or the Android emulator for testing here. Set up what can be done on Windows (`ios.bundleIdentifier` in `app.json`; `eas.json` via `npx eas-cli build:configure`, run by the user after logging in). Never claim an iOS build was made or tested.

## Verify (required before saying done)
- `npx expo-doctor` exits 0, or each reported problem is fixed or explained.
- `npx tsc --noEmit` exits 0 (TypeScript projects). Tests if the project has them: `npx jest --ci` (jest-expo preset) or `npm test`.
- `npx expo export --platform web` (or `--platform android`) exits 0: the app bundles.
- A screenshot of the running app: web with the Playwright connector (`use_connector` "Playwright") at a phone size such as 390x844, or Android with `adb shell screencap -p /sdcard/shot.png; adb pull /sdcard/shot.png shots/android.png`, then `view_image` or `analyze_image` it.
- Never say the app works on a platform you did not run it on. iOS is "not verified on this PC" unless the user tested it in Expo Go and told you.

## Output
- **What changed:** screens and files.
- **How to run:** exact commands for web, the Android emulator, and an iPhone with Expo Go.
- **Checks:** expo-doctor, tsc, tests, export, with exit codes; screenshot path.
- **Platforms:** verified (web preview, Android emulator) and not verified (iOS, physical devices).
- **Next:** for store builds, EAS (`npx eas-cli build -p android` or `-p ios`) and the accounts it needs.

## Pitfalls
- Offering `react-native run-ios`, Xcode or the iOS simulator on Windows.
- `npm install` of native modules instead of `npx expo install`; expo-doctor then reports version mismatches.
- Running `npx expo start` in the foreground with `run_command`: it never exits and the call times out. Use `Start-Process`, or `npx expo export` for checks.
- `adb exec-out screencap -p > shot.png` in Windows PowerShell corrupts the PNG (text encoding); capture on the device and `adb pull` it.
- HTML elements (`div`, `span`, `onClick`) in React Native code: the web preview may render them, devices fail.
- Expo Go from the App Store supports only the newest SDK; an older project may not open on a real iPhone until upgraded.
- Commands that wait for input: `create-expo-app` without `--yes`, EAS commands before the user has logged in.
