#!/usr/bin/env bash
# Bash wrapper (Git Bash / MSYS2) for abrir-emulador.ps1
# Usage: ./abrir-emulador.sh [AVD name] [--quick] [--software-gpu]
# Cold boot is the default; --quick resumes from the saved snapshot
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ps_script="$(cygpath -w "$script_dir/abrir-emulador.ps1")"
ps_args=()
for arg in "$@"; do
  case "$arg" in
    --quick) ps_args+=("-QuickBoot") ;;
    --cold) ;;
    --software-gpu) ps_args+=("-SoftwareGpu") ;;
    *) ps_args+=("-AvdName" "$arg") ;;
  esac
done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" "${ps_args[@]}"
