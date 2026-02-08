# pico-ctr-web

Web-based configuration interface for [PicoCTR](https://github.com/ACustomArcade/pico-ctr-firmware) arcade controllers. Hosted on GitHub Pages and uses the **WebHID** browser API to communicate with PicoCTR devices over USB.

**Live site**: [picoctr.com](https://picoctr.com)

## Features

- **Direct USB communication** via WebHID (no drivers or software needed)
- **Read/write RGB settings** — enable/disable, animation mode, color, brightness
- **Live preview** — changes apply instantly without saving
- **Save to flash** — persist settings across power cycles
- **Device info** — shows firmware version, board name, build type
- **Firmware update** — enter BOOTSEL mode directly from the browser
- **Auto-generated config** — settings and supported devices are parsed from firmware source annotations

## Browser Requirements

WebHID requires **Chrome 89+** or **Edge 89+**. Firefox and Safari are not supported.

## How It Works

1. Plug in your PicoCTR controller via USB
2. Click **Connect PicoCTR** and select the device in the browser picker
3. The interface reads current settings and firmware info from the device
4. Modify settings as desired — changes apply in real-time for preview
5. Click **Save to Flash** to persist changes

## Architecture

```
index.html          — Main UI
css/style.css       — Styles
js/webhid.js        — WebHID communication layer (PicoCTRDevice class)
js/app.js           — Application logic and UI management
picoctr-config.json — Auto-generated device/settings config
```

### WebHID Communication

The PicoCTR firmware exposes a vendor-defined HID interface with feature reports for settings management:

| Report ID | Name | Direction | Description |
|-----------|------|-----------|-------------|
| 0xF1 | settings_get | IN | Read current RGB settings |
| 0xF2 | settings_set | OUT | Write RGB settings |
| 0xF3 | settings_save | OUT | Save to flash |
| 0xF4 | settings_reset | OUT | Reset to defaults |
| 0xF7 | settings_get_flash | IN | Read persisted settings |
| 0xF8 | bootsel | OUT | Enter firmware update mode |
| 0xF9 | version | IN | Firmware version string |
| 0xFA | version_full | IN | Full git version |
| 0xFB | build_type | IN | Release/Debug |
| 0xFC | board | IN | Board identity |

The WebHID filter targets vendor usage page `0xFF00` to select only the settings interface (not gamepad interfaces).

## Updating Config from Firmware

The `picoctr-config.json` is generated from firmware source annotations using:

```bash
cd /path/to/amgearco-ctr
python3 tools/generate_web_config.py
```

This parses `@picoctr:` annotation comments in:
- `settings.h` — report IDs, enums, field definitions
- `CMakeLists.txt` — device/board variants with VID/PID

The generated JSON drives the web UI so it automatically reflects firmware capabilities.

## Development

This is a pure static site — no build step required. Open `index.html` in Chrome/Edge to test locally. Note that WebHID requires HTTPS or localhost.

For local development with a web server:
```bash
python3 -m http.server 8000
# Then open http://localhost:8000
```

## Deployment

Deployed automatically via GitHub Actions on push to `main`. The workflow in `.github/workflows/deploy.yml` publishes the entire repository to GitHub Pages.

## License

MIT
