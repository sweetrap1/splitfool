# SplitFool: Android Release Guide

This guide outlines the steps to build and deploy future updates for the SplitFool Android app.

## 📋 Prerequisites

Ensure your environment variables are set (these are temporary for the terminal session):

```powershell
$env:JAVA_HOME="C:\Users\Administrator\.bubblewrap\jdk\jdk-17.0.11+9"
$env:GRADLE_USER_HOME="C:\tmp_gradle_home"
```

## 🚀 Steps to Release a New Version

### 1. Update Version Numbers (Optional but Recommended)
In [C:\apps\splitfool\app\build.gradle](file:///C:/apps/splitfool/app/build.gradle), increment the `versionCode` (integer) and `versionName` (string):

```gradle
defaultConfig {
    ...
    versionCode 3
    versionName "3"
}
```

### 2. Clean and Build Artifacts
Run the following command in the `C:\apps\splitfool` directory to generate a signed App Bundle (.aab) and APK (.apk):

```powershell
./gradlew.bat clean bundleRelease assembleRelease
```

> [!NOTE]
> If you encounter memory errors, ensure `gradle.properties` contains `org.gradle.jvmargs=-Xmx1024m`.

### 3. Locate Your Artifacts
Once the build is successful, your files will be here:
- **Play Store Bundle**: `C:\apps\splitfool\app\build\outputs\bundle\release\app-release.aab`
- **Direct Install APK**: `C:\apps\splitfool\app\build\outputs\apk\release\app-release.apk`

### 4. Deploy Web Changes (If Necessary)
If you made changes to the web files or `assetlinks.json`, deploy to Firebase Hosting:

```powershell
firebase use splitfool-4ca6b
firebase deploy --only hosting
```

## 🔐 Security & Signing
The build automatically signs your app using `C:\apps\splitfool\android.keystore`. 
- **Keystore Passwords**: `splitfool123`
- **Key Alias**: `android`

## 🔄 Web vs. Native Updates

Because your app is a **Trusted Web Activity (TWA)**, it works like a specialized browser pointing to your URL: `https://splitfool-4ca6b.web.app`.

### 1. Web Changes (Instant)
If you only change your **HTML, JS, CSS, or Icons** on the website:
- **Action**: Run `firebase deploy --only hosting`.
- **Result**: Users who already Have the app installed will see these changes immediately the next time they open the app. **You do NOT need to rebuild the APK or upload a new AAB to the Play Store.**

### 2. Native Changes (Requires Rebuild)
If you change things in the **Android Project** or `twa-manifest.json`:
- **Examples**: Changing the App Name, App Icon (on the home screen), Splash Screen, or Package ID.
- **Action**: Increment the `versionCode`, run the `./gradlew.bat bundleRelease` command, and upload the new `.aab` to the Google Play Console.

> [!CAUTION]
> Never delete the `android.keystore` file. Google Play requires the same certificate to sign all updates for the same app.
