#!/bin/bash
# NSIS 설치 파일을 wine 으로 실제 설치해 보는 스모크 테스트 (Linux 에서만 의미 있음).
set -u
PREFIX="${1:-/tmp/markview-wine}"
SETUP="${2:-release/MarkView-1.0.0-Setup.exe}"
export WINEPREFIX="$PREFIX" WINEARCH=win32 WINEDEBUG=-all
rm -rf "$PREFIX"
xvfb-run -a wineboot -i >/dev/null 2>&1
echo "[1/3] 설치 실행 (/S 무인 모드)…"
xvfb-run -a wine "$SETUP" /S >/dev/null 2>&1
echo "[2/3] 설치 결과 확인…"
find "$PREFIX/drive_c" -maxdepth 8 -iname "*markview*" 2>/dev/null | sed "s|$PREFIX/drive_c|C:|" | sort
echo "[3/3] 레지스트리 확인…"
grep -i -A6 "markview" "$PREFIX/user.reg" 2>/dev/null | head -60
echo "DONE"
