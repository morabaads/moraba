#!/usr/bin/env bash
# Builds «مربع چت» for Windows with mingw-w64 (apt install mingw-w64) → assets/app/MorabaChat.exe.
# Needs the WebView2 SDK (headers + WebView2Loader.dll): fetched once from NuGet into .vendor/ (not committed).
# The site's address is not built in: the panel writes it into the file on download (MP_Frontend::chat_exe).
set -euo pipefail
cd "$(dirname "$0")"
WV2=1.0.2849.39
V=.vendor/webview2-$WV2
if [ ! -f "$V/build/native/include/WebView2.h" ]; then
  mkdir -p "$V"
  curl -sSL -o "$V.nupkg" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WV2/microsoft.web.webview2.$WV2.nupkg"
  (cd "$V" && unzip -q -o "../webview2-$WV2.nupkg")
fi
# WebView2.h includes EventToken.h from the Windows SDK; mingw has none.
[ -f "$V/build/native/include/EventToken.h" ] || printf '#pragma once\ntypedef struct EventRegistrationToken { __int64 value; } EventRegistrationToken;\n' > "$V/build/native/include/EventToken.h"
cp "$V/runtimes/win-x64/native/WebView2Loader.dll" .vendor/WebView2Loader.dll
x86_64-w64-mingw32-windres moraba-chat.rc -O coff -o .vendor/res.o
x86_64-w64-mingw32-gcc -municode -mwindows -O2 -s -Wall -Wextra -Wno-unused-parameter -Wno-cast-function-type -Wno-unknown-pragmas -Wno-missing-field-initializers -isystem "$V/build/native/include" \
  -o ../../assets/app/MorabaChat.exe moraba-chat.c .vendor/res.o \
  -lole32 -loleaut32 -lshell32 -luuid -ldwmapi -lurlmon -lwtsapi32 -lpowrprof -lbcrypt -luxtheme -luser32 -lgdi32 -static
# sign the build (update-key.pem stays in apps/, never in the plugin): installed copies only accept signed updates
[ -f update-key.h ] || python3 sign.py pub update-key.pem update-key.h
python3 sign.py sign update-key.pem ../../assets/app/MorabaChat.exe ../../assets/app/MorabaChat.exe.sig
ls -l ../../assets/app/MorabaChat.exe ../../assets/app/MorabaChat.exe.sig
