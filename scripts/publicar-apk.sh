#!/usr/bin/env bash
# Bash wrapper (Git Bash / MSYS2) for publicar-apk.ps1
# Usage: ./publicar-apk.sh [--notes "What changed"] [--version 1.2]
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ps_script="$(cygpath -w "$script_dir/publicar-apk.ps1")"
ps_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) ps_args+=("-Notes" "$2"); shift 2 ;;
    --version) ps_args+=("-VersionName" "$2"); shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" "${ps_args[@]}"
