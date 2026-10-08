#!/usr/bin/env bash
# Builds «مربع چت» for Windows with mingw-w64 (apt install mingw-w64) → assets/app/MorabaChat.exe.
# The site's address is not built in: the panel writes it into the file on download (MP_Frontend::chat_exe).
set -euo pipefail
cd "$(dirname "$0")"
CC=x86_64-w64-mingw32-gcc
x86_64-w64-mingw32-windres moraba-chat.rc -O coff -o build-res.o
$CC -municode -mwindows -O2 -s -Wall -Wextra -Wno-unused-parameter -o ../../assets/app/MorabaChat.exe moraba-chat.c build-res.o \
  -lole32 -lshell32 -luuid -static
rm -f build-res.o
ls -l ../../assets/app/MorabaChat.exe
