#!/usr/bin/env bash
# Builds the Android app without Gradle: aapt2 → javac → d8 (or dx) → zipalign → apksigner.
# Tools: an Android SDK (ANDROID_HOME, default /opt/android: platforms;android-34 + build-tools;35.0.0), or
# set AAPT2, ANDROID_JAR (any API 34 android.jar with resources, e.g. Robolectric's android-all 14) and have
# dalvik-exchange (dx), zipalign and apksigner on PATH.
# SITE=https://example.ir ./build.sh — the address the app suggests on its first screen (optional).
# APP=chat ./build.sh — «مربع چت» instead: the same code with Config.CHAT, AndroidManifest.chat.xml, package
# ir.moraba.chat (installs beside the main app) → assets/app/moraba-chat.apk.
# Output: assets/app/moraba.apk (shipped inside the plugin, downloaded from the panel and the portal).
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android}"
BT="$SDK/build-tools/35.0.0"
JAR="${ANDROID_JAR:-$SDK/platforms/android-34/android.jar}"
AAPT2="${AAPT2:-$BT/aapt2}"
ZIPALIGN="$( [ -x "$BT/zipalign" ] && echo "$BT/zipalign" || echo zipalign )"
APKSIGNER="$( [ -x "$BT/apksigner" ] && echo "$BT/apksigner" || echo apksigner )"
CHAT=false; MANIFEST=AndroidManifest.xml; RENAME=(); OUT="../../assets/app/moraba.apk"
if [ "${APP:-}" = chat ]; then
  CHAT=true; MANIFEST=AndroidManifest.chat.xml; RENAME=(--rename-manifest-package ir.moraba.chat); OUT="../../assets/app/moraba-chat.apk"
fi
rm -rf build && mkdir -p build/gen/ir/moraba/panel build/classes build/dex

# The site the first screen suggests (empty: the person types it once).
printf 'package ir.moraba.panel;\n\n/** Made by build.sh. */\nfinal class Config {\n    private Config() {}\n    static final String SITE = "%s";\n    static final boolean CHAT = %s;\n}\n' "${SITE:-}" "$CHAT" > build/gen/ir/moraba/panel/Config.java

"$AAPT2" compile --dir res -o build/res.zip
"$AAPT2" link -o build/app.unaligned.apk -I "$JAR" --manifest "$MANIFEST" "${RENAME[@]}" --java build/gen \
  --min-sdk-version 24 --target-sdk-version 34 build/res.zip
javac -nowarn -encoding UTF-8 --release 8 -classpath "$JAR" -d build/classes \
  $(find build/gen src -name '*.java') 2>&1 | grep -v 'bootstrap class path\|^1 warning\|source value 8\|target value 8\|To suppress warnings\|JAVA_TOOL_OPTIONS\|deprecat\|^Note:' || true
test -f build/classes/ir/moraba/panel/MainActivity.class
if [ -x "$BT/d8" ]; then
  "$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
else
  dalvik-exchange --dex --min-sdk-version=24 --output=build/dex/classes.dex build/classes 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
fi
(cd build/dex && zip -q -u ../app.unaligned.apk classes.dex)
"$ZIPALIGN" -f -p 4 build/app.unaligned.apk build/app.aligned.apk
# The same key every time, so a new version installs over the old one.
"$APKSIGNER" sign --v4-signing-enabled false --ks moraba.keystore --ks-pass pass:moraba-panel --key-pass pass:moraba-panel --out "$OUT" build/app.aligned.apk 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
"$APKSIGNER" verify "$OUT" 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
ls -l "$OUT"
