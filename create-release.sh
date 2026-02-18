#!/usr/bin/env bash
# create-release.sh — Create a GitHub release for PicoCTR firmware
#
# Reads a firmware.json (from a build output directory), validates that the
# version matches a tag in the amgearco-ctr firmware repo, then creates a
# tag + release in ACustomArcade/pico-ctr-web and uploads all UF2 files and
# firmware.json as release assets.
#
# Authentication:
#   export GITHUB_TOKEN="ghp_..."   (personal access token with repo scope)
#   Or run in a VS Code terminal with GitHub extension signed in.
#
# Usage:
#   ./create-release.sh <path/to/firmware.json>
#
# Examples:
#   ./create-release.sh firmware/firmware.json
#   ./create-release.sh ../amgearco-ctr/build/firmware.json
#
# Requirements: bash, curl, jq

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
OWNER="ACustomArcade"
WEB_REPO="pico-ctr-web"
FW_REPO="amgearco-ctr"
API_BASE="https://api.github.com"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
die()  { echo -e "${RED}Error: $*${NC}" >&2; exit 1; }
info() { echo -e "${CYAN}$*${NC}"; }
ok()   { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }

# ── Preflight checks ─────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || die "curl is required but not found"
command -v jq   >/dev/null 2>&1 || die "jq is required but not found"

if [[ $# -lt 1 ]]; then
    die "Usage: $0 <path/to/firmware.json>\n" \
        "  Example: $0 firmware/firmware.json\n" \
        "  Example: $0 ../amgearco-ctr/build/firmware.json"
fi

FIRMWARE_JSON="$1"
[[ -f "$FIRMWARE_JSON" ]] || die "Cannot find ${FIRMWARE_JSON}"

# UF2 files are expected in the same directory as firmware.json
FIRMWARE_DIR="$(cd "$(dirname "$FIRMWARE_JSON")" && pwd)"
FIRMWARE_JSON="${FIRMWARE_DIR}/$(basename "$FIRMWARE_JSON")"

info "Using firmware.json: ${FIRMWARE_JSON}"
info "Assets directory:    ${FIRMWARE_DIR}"

# ── Authentication ────────────────────────────────────────────────────────────
# Use GITHUB_TOKEN if set, otherwise ask git's credential helper (works
# automatically in VS Code devcontainers where the GitHub extension manages
# OAuth credentials).
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    info "GITHUB_TOKEN not set — trying git credential helper..."
    GITHUB_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \
        | git credential fill 2>/dev/null \
        | awk -F= '/^password=/{print $2}')
    if [[ -z "$GITHUB_TOKEN" ]]; then
        die "Could not obtain GitHub credentials.\n" \
            "  Either export GITHUB_TOKEN or run inside a VS Code terminal\n" \
            "  with the GitHub extension signed in."
    fi
    ok "Obtained token from git credential helper"
fi

auth_header="Authorization: token ${GITHUB_TOKEN}"

# Verify token works
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$auth_header" "${API_BASE}/user")
[[ "$http_code" == "200" ]] || die "GitHub token validation failed (HTTP ${http_code}). Check your credentials."

# ── Read version from firmware.json ───────────────────────────────────────────
FW_VERSION=$(jq -r '.version' "$FIRMWARE_JSON")
[[ -n "$FW_VERSION" && "$FW_VERSION" != "null" ]] || die "Could not read version from ${FIRMWARE_JSON}"

TAG_NAME="v${FW_VERSION}"
info "Firmware version: ${FW_VERSION}"
info "Tag name:         ${TAG_NAME}"

# ── Validate against amgearco-ctr tag ─────────────────────────────────────────
# Strategy: check remote first, then fall back to local repo + auto-push.
info "Checking that tag ${TAG_NAME} exists in ${OWNER}/${FW_REPO}..."

tag_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$auth_header" \
    "${API_BASE}/repos/${OWNER}/${FW_REPO}/git/refs/tags/${TAG_NAME}")

if [[ "$tag_status" == "200" ]]; then
    ok "Tag ${TAG_NAME} exists in ${OWNER}/${FW_REPO}"
else
    # Tag not on remote — check local repo (walk up from firmware.json dir)
    LOCAL_REPO="$(git -C "$FIRMWARE_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

    if [[ -n "$LOCAL_REPO" ]] && git -C "$LOCAL_REPO" rev-parse "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
        warn "Tag ${TAG_NAME} exists locally but not on remote"
        info "Pushing tag ${TAG_NAME} to origin..."
        git -C "$LOCAL_REPO" push origin "${TAG_NAME}"
        ok "Tag ${TAG_NAME} pushed to origin"
    else
        die "Tag ${TAG_NAME} does not exist locally or in ${OWNER}/${FW_REPO}.\n" \
            "  Create it first: git tag -a ${TAG_NAME} -m \"Release ${TAG_NAME}\"\n" \
            "  Then push:       git push origin ${TAG_NAME}"
    fi
fi

# ── Detect prerelease ─────────────────────────────────────────────────────────
PRERELEASE=false
if [[ "$FW_VERSION" =~ -(rc|alpha|beta|dev) ]]; then
    PRERELEASE=true
    warn "Detected prerelease version"
fi

# ── Build release name ────────────────────────────────────────────────────────
# Convert "2.0.1-rc4" → "v2.0.1 RC4" for a clean release title
RELEASE_NAME="v${FW_VERSION}"
if [[ "$FW_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-(.+)$ ]]; then
    base="${BASH_REMATCH[1]}"
    suffix="${BASH_REMATCH[2]}"
    suffix_upper=$(echo "$suffix" | tr '[:lower:]' '[:upper:]')
    RELEASE_NAME="v${base} ${suffix_upper}"
fi
info "Release name: ${RELEASE_NAME}"

# ── Collect assets to upload ──────────────────────────────────────────────────
ASSETS=()

# Add firmware.json
ASSETS+=("$FIRMWARE_JSON")

# Add all UF2 files referenced in firmware.json
while IFS= read -r uf2_file; do
    uf2_path="${FIRMWARE_DIR}/${uf2_file}"
    if [[ -f "$uf2_path" ]]; then
        ASSETS+=("$uf2_path")
    else
        warn "UF2 file listed in firmware.json but not found: ${uf2_path}"
    fi
done < <(jq -r '.firmware[][] | .file' "$FIRMWARE_JSON")

info "Assets to upload (${#ASSETS[@]}):"
for asset in "${ASSETS[@]}"; do
    echo "  - $(basename "$asset")"
done

# ── Check if release already exists ───────────────────────────────────────────
existing_release=$(curl -s -H "$auth_header" \
    "${API_BASE}/repos/${OWNER}/${WEB_REPO}/releases/tags/${TAG_NAME}")

if echo "$existing_release" | jq -e '.id' >/dev/null 2>&1; then
    existing_id=$(echo "$existing_release" | jq -r '.id')
    warn "Release ${TAG_NAME} already exists (id: ${existing_id})"
    echo ""
    read -rp "Delete existing release and recreate? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        info "Deleting existing release..."
        curl -s -X DELETE -H "$auth_header" \
            "${API_BASE}/repos/${OWNER}/${WEB_REPO}/releases/${existing_id}" \
            -o /dev/null -w "  HTTP %{http_code}\n"
        ok "Existing release deleted"
    else
        die "Release already exists. Aborting."
    fi
fi

# ── Create tag (if it doesn't already exist) ──────────────────────────────────
info "Checking if tag ${TAG_NAME} exists in ${OWNER}/${WEB_REPO}..."
tag_check=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "$auth_header" \
    "${API_BASE}/repos/${OWNER}/${WEB_REPO}/git/refs/tags/${TAG_NAME}")

if [[ "$tag_check" == "200" ]]; then
    info "Tag ${TAG_NAME} already exists"
else
    info "Creating tag ${TAG_NAME} on main branch..."

    # Get the SHA of the main branch HEAD
    main_sha=$(curl -s -H "$auth_header" \
        "${API_BASE}/repos/${OWNER}/${WEB_REPO}/git/refs/heads/main" \
        | jq -r '.object.sha')
    [[ -n "$main_sha" && "$main_sha" != "null" ]] \
        || die "Could not get main branch SHA for ${OWNER}/${WEB_REPO}"

    # Create lightweight tag
    create_tag_resp=$(curl -s -H "$auth_header" \
        -H "Content-Type: application/json" \
        -X POST "${API_BASE}/repos/${OWNER}/${WEB_REPO}/git/refs" \
        -d "{\"ref\":\"refs/tags/${TAG_NAME}\",\"sha\":\"${main_sha}\"}")

    if echo "$create_tag_resp" | jq -e '.ref' >/dev/null 2>&1; then
        ok "Tag ${TAG_NAME} created (SHA: ${main_sha:0:7})"
    else
        error_msg=$(echo "$create_tag_resp" | jq -r '.message // "unknown error"')
        die "Failed to create tag: ${error_msg}"
    fi
fi

# ── Create release ────────────────────────────────────────────────────────────
info "Creating release ${RELEASE_NAME}..."

FW_DATE=$(jq -r '.date // empty' "$FIRMWARE_JSON")

# Build release body as proper markdown (using real newlines)
RELEASE_BODY="## PicoCTR Firmware ${RELEASE_NAME}"
RELEASE_BODY+=$'\n\n'
[[ -n "$FW_DATE" ]] && RELEASE_BODY+="**Release date:** ${FW_DATE}" && RELEASE_BODY+=$'\n\n'

# Group firmware entries by manufacturer
for mfr in $(jq -r '.firmware | keys[]' "$FIRMWARE_JSON"); do
    RELEASE_BODY+="### ${mfr}"
    RELEASE_BODY+=$'\n\n'
    RELEASE_BODY+="| Firmware | File | Description |"
    RELEASE_BODY+=$'\n'
    RELEASE_BODY+="|----------|------|-------------|"
    RELEASE_BODY+=$'\n'
    while IFS=$'\t' read -r name file description; do
        RELEASE_BODY+="| ${name} | \`${file}\` | ${description} |"
        RELEASE_BODY+=$'\n'
    done < <(jq -r --arg m "$mfr" '.firmware[$m][] | [.name, .file, .description] | @tsv' "$FIRMWARE_JSON")
    RELEASE_BODY+=$'\n'
done

RELEASE_BODY+=$'---\n\n'
RELEASE_BODY+="*See [picoctr.com](https://picoctr.com) for configuration and documentation.*"

create_release_payload=$(jq -n \
    --arg tag "$TAG_NAME" \
    --arg name "$RELEASE_NAME" \
    --arg body "$RELEASE_BODY" \
    --argjson prerelease "$PRERELEASE" \
    '{
        tag_name: $tag,
        target_commitish: "main",
        name: $name,
        body: $body,
        draft: false,
        prerelease: $prerelease
    }')

create_resp=$(curl -s -H "$auth_header" \
    -H "Content-Type: application/json" \
    -X POST "${API_BASE}/repos/${OWNER}/${WEB_REPO}/releases" \
    -d "$create_release_payload")

RELEASE_ID=$(echo "$create_resp" | jq -r '.id // empty')
UPLOAD_URL=$(echo "$create_resp" | jq -r '.upload_url // empty' | sed 's/{[^}]*}$//')

if [[ -z "$RELEASE_ID" || "$RELEASE_ID" == "null" ]]; then
    error_msg=$(echo "$create_resp" | jq -r '.message // "unknown error"')
    die "Failed to create release: ${error_msg}"
fi

ok "Release created (id: ${RELEASE_ID})"

# ── Upload assets ─────────────────────────────────────────────────────────────
info "Uploading ${#ASSETS[@]} assets..."

upload_count=0
upload_fail=0

for asset_path in "${ASSETS[@]}"; do
    asset_name=$(basename "$asset_path")

    # Determine content type
    if [[ "$asset_name" == *.uf2 ]]; then
        content_type="application/octet-stream"
    elif [[ "$asset_name" == *.json ]]; then
        content_type="application/json"
    else
        content_type="application/octet-stream"
    fi

    echo -n "  Uploading ${asset_name}... "

    upload_resp=$(curl -s \
        -H "$auth_header" \
        -H "Content-Type: ${content_type}" \
        --data-binary "@${asset_path}" \
        "${UPLOAD_URL}?name=${asset_name}")

    asset_id=$(echo "$upload_resp" | jq -r '.id // empty')
    if [[ -n "$asset_id" && "$asset_id" != "null" ]]; then
        asset_size=$(echo "$upload_resp" | jq -r '.size')
        echo -e "${GREEN}OK${NC} (${asset_size} bytes)"
        upload_count=$((upload_count + 1))
    else
        error_msg=$(echo "$upload_resp" | jq -r '.message // "unknown error"')
        echo -e "${RED}FAILED${NC}: ${error_msg}"
        upload_fail=$((upload_fail + 1))
    fi
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
if [[ $upload_fail -eq 0 ]]; then
    ok "Release ${RELEASE_NAME} created successfully!"
    ok "  ${upload_count}/${#ASSETS[@]} assets uploaded"
else
    warn "Release created with errors"
    warn "  ${upload_count} uploaded, ${upload_fail} failed"
fi

RELEASE_URL="https://github.com/${OWNER}/${WEB_REPO}/releases/tag/${TAG_NAME}"
info "Release URL: ${RELEASE_URL}"
echo "========================================"
