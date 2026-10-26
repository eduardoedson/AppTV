#!/usr/bin/env bash
# Bash wrapper (Git Bash / MSYS2) for enviar-catalogo.ps1
# Usage: ./enviar-catalogo.sh [--force]
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ps_script="$(cygpath -w "$script_dir/enviar-catalogo.ps1")"
ps_args=()
for arg in "$@"; do
  case "$arg" in
    --force) ps_args+=("-Force") ;;
  esac
done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" "${ps_args[@]}"
