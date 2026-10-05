#!/usr/bin/env bash
# Builds the Android widget app without Gradle: aapt2 → javac → d8 → zipalign → apksigner.
# Needs the Android SDK (platforms;android-34 and build-tools;35.0.0): ANDROID_HOME=/opt/android by default.
# Output: assets/app/moraba.apk (shipped inside the plugin, downloaded from the panel).
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT="../../assets/app/moraba.apk"
rm -rf build && mkdir -p build/gen build/classes build/dex

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/app.unaligned.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen \
  --min-sdk-version 24 --target-sdk-version 34 build/res.zip
javac -nowarn -encoding UTF-8 --release 8 -classpath "$JAR" -d build/classes \
  $(find build/gen src -name '*.java') 2>&1 | grep -v 'bootstrap class path\|^1 warning\|source value 8\|target value 8\|To suppress warnings' || true
test -f build/classes/ir/moraba/panel/MainActivity.class
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -u ../app.unaligned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/app.unaligned.apk build/app.aligned.apk
# The same key every time, so a new version installs over the old one.
"$BT/apksigner" sign --v4-signing-enabled false --ks moraba.keystore --ks-pass pass:moraba-panel --key-pass pass:moraba-panel --out "$OUT" build/app.aligned.apk
"$BT/apksigner" verify "$OUT"
ls -l "$OUT"
