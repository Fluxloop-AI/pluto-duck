#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: reset_fluxloop_env.sh [OPTIONS]

Remove FluxLoop-only local state and installed FluxLoop packages/tools.

Options:
  --yes, -y                Skip confirmation prompt
  --dry-run                Print actions without deleting/uninstalling
  --project-root PATH      Project root to clean (default: current directory)
  -h, --help               Show this help

Examples:
  bash reset_fluxloop_env.sh --dry-run
  bash reset_fluxloop_env.sh --yes
EOF
}

ASSUME_YES=false
DRY_RUN=false
PROJECT_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      ASSUME_YES=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --project-root)
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --project-root=*)
      PROJECT_ROOT="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
  PROJECT_ROOT="$(pwd)"
else
  PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"
fi

HOME_FLUXLOOP="${HOME}/.fluxloop"

PROJECT_PATHS=(
  "${PROJECT_ROOT}/.fluxloop"
  "${PROJECT_ROOT}/.fluxloop_pytest"
)

NESTED_FLUXLOOP_PATHS=()

log() {
  printf '[INFO] %s\n' "$1"
}

ok() {
  printf '[ OK ] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_best_effort() {
  local description="$1"
  shift

  if $DRY_RUN; then
    log "DRY-RUN: ${description}"
    return 0
  fi

  if "$@" >/dev/null 2>&1; then
    ok "${description}"
  else
    warn "${description} (skipped or not installed)"
  fi
}

remove_path_if_exists() {
  local path="$1"

  if [[ -e "$path" || -L "$path" ]]; then
    run_best_effort "Remove ${path}" rm -rf -- "$path"
  else
    log "Skip (not found): ${path}"
  fi
}

collect_nested_fluxloop_paths() {
  NESTED_FLUXLOOP_PATHS=()

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ "$path" != "${PROJECT_ROOT}/.fluxloop" ]]; then
      NESTED_FLUXLOOP_PATHS+=("$path")
    fi
  done < <(find "$PROJECT_ROOT" -mindepth 2 \( -type d -o -type l \) -name ".fluxloop" 2>/dev/null)
}

print_plan() {
  cat <<EOF
Project root : ${PROJECT_ROOT}
Dry run      : ${DRY_RUN}

Will clean:
  - project FluxLoop state folders (.fluxloop, .fluxloop_pytest)
  - ${HOME_FLUXLOOP}
  - project dependencies via uv remove (if pyproject.toml exists)
  - FluxLoop packages from pipx / uv tool / pip
EOF

  if [[ "${#NESTED_FLUXLOOP_PATHS[@]}" -gt 0 ]]; then
    printf '  - nested .fluxloop directories (%s found)\n' "${#NESTED_FLUXLOOP_PATHS[@]}"
  fi
}

confirm_if_needed() {
  if $ASSUME_YES; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    warn "Non-interactive shell detected. Re-run with --yes or --dry-run."
    exit 1
  fi

  local response
  read -r -p "Proceed with reset? [y/N] " response
  case "${response}" in
    y|Y|yes|YES)
      ;;
    *)
      log "Cancelled."
      exit 0
      ;;
  esac
}

cleanup_project_paths() {
  log "Cleaning project paths"
  local path
  for path in "${PROJECT_PATHS[@]}"; do
    remove_path_if_exists "$path"
  done
}

cleanup_nested_fluxloop_paths() {
  if [[ "${#NESTED_FLUXLOOP_PATHS[@]}" -eq 0 ]]; then
    log "No nested .fluxloop directories found"
    return
  fi

  log "Cleaning nested .fluxloop directories"
  local path
  for path in "${NESTED_FLUXLOOP_PATHS[@]}"; do
    remove_path_if_exists "$path"
  done
}

cleanup_home_fluxloop() {
  log "Cleaning ${HOME_FLUXLOOP}"
  remove_path_if_exists "${HOME_FLUXLOOP}"
}

remove_project_fluxloop_dependencies() {
  if [[ ! -f "${PROJECT_ROOT}/pyproject.toml" ]]; then
    log "Skip project dependency cleanup (pyproject.toml not found)"
    return
  fi

  if ! has_cmd uv; then
    log "Skip project dependency cleanup (uv not found)"
    return
  fi

  if $DRY_RUN; then
    log "DRY-RUN: uv remove fluxloop (project dependency)"
    log "DRY-RUN: uv remove fluxloop-cli (project dependency)"
    return
  fi

  if (cd "${PROJECT_ROOT}" && uv remove fluxloop >/dev/null 2>&1); then
    ok "uv remove fluxloop (project dependency)"
  else
    warn "uv remove fluxloop (skipped or not in project deps)"
  fi

  if (cd "${PROJECT_ROOT}" && uv remove fluxloop-cli >/dev/null 2>&1); then
    ok "uv remove fluxloop-cli (project dependency)"
  else
    warn "uv remove fluxloop-cli (skipped or not in project deps)"
  fi
}

uninstall_fluxloop_tools() {
  log "Uninstalling FluxLoop tools/packages"

  if has_cmd pipx; then
    run_best_effort "pipx uninstall fluxloop-cli" pipx uninstall fluxloop-cli
    run_best_effort "pipx uninstall fluxloop" pipx uninstall fluxloop
  else
    log "Skip pipx uninstall (pipx not found)"
  fi

  if has_cmd uv; then
    run_best_effort "uv tool uninstall fluxloop-cli" uv tool uninstall fluxloop-cli
    run_best_effort "uv tool uninstall fluxloop" uv tool uninstall fluxloop
    run_best_effort "uv pip uninstall --system fluxloop-cli fluxloop" uv pip uninstall --system fluxloop-cli fluxloop
  else
    log "Skip uv tool/pip uninstall (uv not found)"
  fi

  if has_cmd python3; then
    run_best_effort "python3 -m pip uninstall -y fluxloop-cli fluxloop" python3 -m pip uninstall -y fluxloop-cli fluxloop
  else
    log "Skip python3 pip uninstall (python3 not found)"
  fi

  if has_cmd python; then
    run_best_effort "python -m pip uninstall -y fluxloop-cli fluxloop" python -m pip uninstall -y fluxloop-cli fluxloop
  else
    log "Skip python pip uninstall (python not found)"
  fi
}

main() {
  collect_nested_fluxloop_paths
  print_plan
  confirm_if_needed

  cleanup_project_paths
  cleanup_nested_fluxloop_paths
  cleanup_home_fluxloop
  remove_project_fluxloop_dependencies
  uninstall_fluxloop_tools

  log "Reset complete."
}

main "$@"
