# PicoCTR Web - AI Coding Instructions

> **⚠️ MANDATORY — Read and apply `.github/00-governance.md` before every response.**
> All AI agent behavior is governed by the Behavioral Integrity Baseline defined
> in that file. Every response MUST include the `[Response Integrity: {n}%]`
> footer. Non-compliance is not optional.

## Project Overview

Static website for PicoCTR arcade controller firmware — hosted on GitHub Pages at [picoctr.com](https://picoctr.com).

Provides:
- WebHID-based device configuration (RGB, button remapping, firmware update)
- Firmware download and online flashing
- Device detection and settings management via browser USB API

## Architecture

| Path | Purpose |
|------|---------|
| `index.html` | Single-page application entry point |
| `css/style.css` | Styling |
| `js/` | JavaScript modules (WebHID, UI, firmware logic) |
| `firmware/` | UF2 firmware files + `firmware.json` manifest |
| `picoctr-config.json` | Device configuration database |
| `docs/HID_API.md` | HID protocol documentation |

## Deployment

- GitHub Pages via `.github/workflows/deploy.yml`
- Triggered on push to `main`, release publish, or manual dispatch
- Firmware assets are downloaded from the latest GitHub release at deploy time

## Release Process

Use `create-release.sh <path/to/firmware.json>` to create a GitHub release with firmware assets. The script:
1. Reads version from the provided `firmware.json`
2. Validates the version tag exists in `ACustomArcade/amgearco-ctr`
3. Creates a tag + release in this repo
4. Uploads all UF2 files and `firmware.json` as release assets
