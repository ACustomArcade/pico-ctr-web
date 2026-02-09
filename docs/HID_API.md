# PicoCTR HID API Reference

> **Version:** 1.0  
> **Firmware:** PicoCTR (amgearco-ctr)  
> **Protocol:** USB HID Feature Reports  
> **Source:** [`settings.h`](https://github.com/ACustomArcade/amgearco-ctr/blob/main/settings.h)

This document describes the HID protocol used by PicoCTR firmware for settings configuration and device management. All communication uses **USB HID Feature Reports** on a vendor-defined HID interface.

---

## Table of Contents

- [Overview](#overview)
- [USB Device Identification](#usb-device-identification)
- [HID Interface](#hid-interface)
- [Report Map](#report-map)
- [Settings Reports](#settings-reports)
  - [Settings Data Layout](#settings-data-layout)
  - [Read Settings (0xF1)](#read-settings-0xf1)
  - [Write Settings (0xF2)](#write-settings-0xf2)
  - [Read Flash Settings (0xF7)](#read-flash-settings-0xf7)
- [Command Reports](#command-reports)
  - [Save to Flash (0xF3)](#save-to-flash-0xf3)
  - [Reset to Defaults (0xF4)](#reset-to-defaults-0xf4)
  - [Enter BOOTSEL (0xF8)](#enter-bootsel-0xf8)
- [Device Info Reports](#device-info-reports)
  - [Firmware Version (0xF9)](#firmware-version-0xf9)
  - [Full Git Version (0xFA)](#full-git-version-0xfa)
  - [Build Type (0xFB)](#build-type-0xfb)
  - [Board Identity (0xFC)](#board-identity-0xfc)
- [Color Order](#color-order)
- [Enumerations](#enumerations)
- [Implementation Notes](#implementation-notes)
  - [WebHID (Browser)](#webhid-browser)
  - [HIDAPI (C/C++/Python)](#hidapi-ccpython)
  - [Linux hidraw](#linux-hidraw)
- [Examples](#examples)
  - [WebHID Example](#webhid-example)
  - [Python hidapi Example](#python-hidapi-example)
  - [C hidapi Example](#c-hidapi-example)

---

## Overview

PicoCTR exposes a **vendor-defined HID interface** alongside its gamepad interface(s). The settings interface uses **Feature Reports** for bidirectional, synchronous communication. This is separate from the gamepad input reports used for button/axis data.

**Key concepts:**

- All settings communication uses **HID Feature Reports** (not Input/Output Reports)
- **GET_REPORT** requests read data from device → host
- **SET_REPORT** requests write data from host → device
- Settings are held in RAM and take effect immediately on write
- Settings must be explicitly saved to flash with the Save command (0xF3)
- The device supports separate reads of RAM settings vs flash-persisted settings, enabling unsaved-change detection

---

## USB Device Identification

PicoCTR devices use several VID/PID combinations depending on the board variant:

| VID | PID | Manufacturer | Description |
|-----|-----|-------------|-------------|
| `0x0838` | `0x8918` | HID (AtGames) | ALU, ALU Mini, Gamer Mini, Gamer Pro, PicoCTR-4P |
| `0x2E8A` | `0x1075` | ACustomArcade | PicoCTR-2P, PicoCTR-2P Dev |
| `0x2E8A` | `0x108F` | Americade | AGC-2P, AGC-4P |
| `0x2E8A` | `0x10DA` | Americade | AGC-Coleco |

To identify the specific board variant after connection, read the [Board Identity](#board-identity-0xfc) report.

---

## HID Interface

The settings interface is identified by its **HID Report Descriptor** usage:

| Property | Value |
|----------|-------|
| Usage Page | `0xFF00` (Vendor Defined) |
| Usage | `0x01` |
| Collection | Application |
| Report Type | Feature (all reports) |

When using the WebHID API, filter by both `usagePage` and `usage` in addition to `vendorId`/`productId` to target specifically the settings interface and avoid the gamepad interface.

---

## Report Map

All reports are **Feature Reports**. "Size" refers to the total declared report size in the HID descriptor (including the report ID byte).

| Report ID | Name | Size | Direction | Description |
|-----------|------|------|-----------|-------------|
| `0xF1` | `settings_get` | 8 | IN (Device → Host) | Read current in-memory RGB settings |
| `0xF2` | `settings_set` | 8 | OUT (Host → Device) | Write RGB settings (applied immediately) |
| `0xF3` | `settings_save` | 8 | OUT (Host → Device) | Persist current settings to flash |
| `0xF4` | `settings_reset` | 8 | OUT (Host → Device) | Reset all settings to factory defaults and save |
| `0xF5` | `button_map_get` | 36 | IN (Device → Host) | Read button mapping *(reserved, not yet active)* |
| `0xF6` | `button_map_set` | 36 | OUT (Host → Device) | Write button mapping *(reserved, not yet active)* |
| `0xF7` | `settings_get_flash` | 8 | IN (Device → Host) | Read flash-persisted settings |
| `0xF8` | `bootsel` | 8 | OUT (Host → Device) | Enter BOOTSEL mode (USB mass storage for firmware update) |
| `0xF9` | `version` | 64 | IN (Device → Host) | Read firmware version string |
| `0xFA` | `version_full` | 64 | IN (Device → Host) | Read full git version string |
| `0xFB` | `build_type` | 64 | IN (Device → Host) | Read build type string |
| `0xFC` | `board` | 64 | IN (Device → Host) | Read board identity string |

---

## Settings Reports

### Settings Data Layout

The settings data consists of **7 bytes** of field data. The report size in the HID descriptor is 8 (7 data bytes + 1 report ID byte).

| Byte Offset | Field | Type | Range | Default | Description |
|-------------|-------|------|-------|---------|-------------|
| 0 | `enable_rgb` | bool | 0–1 | 1 | RGB LED enable (0 = off, 1 = on) |
| 1 | `rgb_animation` | enum | 0–1 | 1 | Animation type (see [Enumerations](#enumerations)) |
| 2 | `rgb_color_r` | uint8 | 0–255 | 255 | Color channel (wire position 0)¹ |
| 3 | `rgb_color_g` | uint8 | 0–255 | 0 | Color channel (wire position 1)¹ |
| 4 | `rgb_color_b` | uint8 | 0–255 | 0 | Color channel (wire position 2)¹ |
| 5 | `led_count` | uint8 | 1–255 | 64 | Number of LEDs in the strip |
| 6 | `led_brightness` | uint8 | 0–255 | 64 | LED brightness |

> ¹ **Color byte order is GRB on the wire**, not RGB. The field names `r`, `g`, `b` correspond to wire positions 0, 1, 2 respectively. See [Color Order](#color-order) for details on transposing to/from display RGB.

### Read Settings (0xF1)

Read the current **in-memory** (active) settings.

- **Report ID:** `0xF1`
- **Direction:** GET_REPORT (Device → Host)
- **Data returned:** 7 bytes (field layout above)

The firmware fills `buffer[0..6]` with data. TinyUSB prepends the report ID byte automatically. The host receives 8 bytes total: `[report_id, enable_rgb, animation, r, g, b, led_count, brightness]`.

### Write Settings (0xF2)

Write settings to the device. Changes take effect **immediately** (LEDs update in real time) but are **not persisted** to flash until a Save command is sent.

- **Report ID:** `0xF2`
- **Direction:** SET_REPORT (Host → Device)
- **Data to send:** 7 bytes (field layout above)

The firmware accepts both 7-byte and 8-byte payloads:
- **7 bytes:** Data only (recommended). The firmware reads fields starting at `buffer[0]`.
- **8 bytes:** Report ID + data. The firmware detects the extra byte and skips `buffer[0]` (the report ID), reading fields from `buffer[1]`.

> **Recommendation:** Always send exactly **7 data bytes** (without the report ID in the data buffer). Most HID APIs send the report ID separately.

### Read Flash Settings (0xF7)

Read settings as they were last **saved to flash**. Comparing these with the in-memory settings (0xF1) lets you detect unsaved changes.

- **Report ID:** `0xF7`
- **Direction:** GET_REPORT (Device → Host)
- **Data returned:** 7 bytes (same layout as [Settings Data Layout](#settings-data-layout))

---

## Command Reports

Command reports do not carry meaningful data in the payload. Send the report ID with a zeroed data buffer of the appropriate size.

### Save to Flash (0xF3)

Persist the current in-memory settings to flash storage. This operation survives power cycles.

- **Report ID:** `0xF3`
- **Direction:** SET_REPORT (Host → Device)
- **Data to send:** 7 zero bytes

> **Note:** Flash write takes a few hundred milliseconds. Wait ~500ms before reading back settings to confirm the save completed.

### Reset to Defaults (0xF4)

Reset all settings to factory defaults **and** save them to flash. This is a destructive operation.

- **Report ID:** `0xF4`
- **Direction:** SET_REPORT (Host → Device)
- **Data to send:** 7 zero bytes

After reset, the device immediately applies the default settings (LEDs will update).

### Enter BOOTSEL (0xF8)

Reboot the device into USB mass storage (PICOBOOT/BOOTSEL) mode for firmware updates. **The device will disconnect from USB HID immediately.**

- **Report ID:** `0xF8`
- **Direction:** SET_REPORT (Host → Device)
- **Data to send:** 7 zero bytes

> **Warning:** After sending this command, the HID device will disappear. The device will re-enumerate as a USB mass storage device (RP2040 BOOTSEL). You can then flash a new UF2 firmware file.

---

## Device Info Reports

Device info reports return **null-terminated UTF-8 strings** in a 64-byte buffer. The first byte may be the report ID depending on the HID API (see [Implementation Notes](#implementation-notes)).

### Firmware Version (0xF9)

Returns the firmware version as a short string, e.g. `"1.0.5"`.

- **Report ID:** `0xF9`
- **Direction:** GET_REPORT (Device → Host)
- **Max length:** 63 characters + null terminator

### Full Git Version (0xFA)

Returns the full git describe string, e.g. `"v1.0.5-3-gabcdef1"` or `"v1.0.5"` for tagged releases.

- **Report ID:** `0xFA`
- **Direction:** GET_REPORT (Device → Host)
- **Max length:** 63 characters + null terminator

### Build Type (0xFB)

Returns the CMake build type, e.g. `"Release"` or `"Debug"`.

- **Report ID:** `0xFB`
- **Direction:** GET_REPORT (Device → Host)
- **Max length:** 63 characters + null terminator

### Board Identity (0xFC)

Returns the board identity string as defined at compile time, e.g. `"americade_agc4p"` or `"acustomarcade_picoctr2p"`.

This is the key identifier for determining which hardware variant the device is. Use it to look up device capabilities (number of gamepads, default LED count, etc.) from your device database.

- **Report ID:** `0xFC`
- **Direction:** GET_REPORT (Device → Host)
- **Max length:** 63 characters + null terminator

---

## Color Order

PicoCTR hardware drives **WS2812-compatible** LED strips that use **GRB** byte order on the wire. The color bytes at offsets 2–4 in the settings report are in **wire order (GRB)**, not display order (RGB).

When writing colors:

| Wire Byte (Offset) | Wire Channel | Display Channel |
|--------------------|-------------|-----------------|
| 2 (`rgb_color_r`) | Green | G |
| 3 (`rgb_color_g`) | Red | R |
| 4 (`rgb_color_b`) | Blue | B |

**To convert display RGB → wire GRB** (for writing):
```
wire[0] = display_green   // offset 2
wire[1] = display_red     // offset 3
wire[2] = display_blue    // offset 4
```

**To convert wire GRB → display RGB** (for reading):
```
display_red   = wire[1]   // offset 3
display_green = wire[0]   // offset 2
display_blue  = wire[2]   // offset 4
```

> **Note:** The color order is `"grb"` for all current PicoCTR hardware. Future variants could potentially use different orders. The machine-readable config file ([`picoctr-config.json`](https://picoctr.github.io/picoctr-config.json)) includes a `color_order` field to handle this generically.

---

## Enumerations

### RGB Animation Types

| Value | Name | Description |
|-------|------|-------------|
| 0 | `solid` | Solid Color — all LEDs set to the configured color |
| 1 | `gradient` | Gradient Fade — animated color cycling effect |

---

## Implementation Notes

The report ID byte is handled differently depending on the HID API you use. This is the most common source of bugs when implementing PicoCTR communication.

### WebHID (Browser)

**GET_REPORT:** `receiveFeatureReport(reportId)` returns a `DataView` where **byte 0 is the report ID**. Field data starts at byte 1.

```javascript
const data = await device.receiveFeatureReport(0xF1);
// data.getUint8(0) === 0xF1 (report ID)
// data.getUint8(1) === enable_rgb (field offset 0)
// data.getUint8(2) === animation  (field offset 1)
// ...
```

**SET_REPORT:** `sendFeatureReport(reportId, data)` sends the report ID **separately**. The `data` buffer should contain **only the 7 field bytes** — do NOT include the report ID in the data array.

```javascript
const data = new Uint8Array(7);  // 7 bytes, NOT 8
data[0] = enable_rgb;   // field offset 0
data[1] = animation;    // field offset 1
data[2] = green;        // field offset 2 (wire order!)
data[3] = red;          // field offset 3 (wire order!)
data[4] = blue;         // field offset 4 (wire order!)
data[5] = led_count;    // field offset 5
data[6] = brightness;   // field offset 6
await device.sendFeatureReport(0xF2, data);
```

> **Critical:** If you send 8 bytes instead of 7, the firmware will see `bufsize == 8 == sizeof(settings_hid_report_t)` and assume the first byte is the report ID, applying a +1 offset that shifts all field values by one position. Always send exactly **7 data bytes**.

### HIDAPI (C/C++/Python)

With hidapi (`hid_get_feature_report` / `hid_send_feature_report`), the report ID is the **first byte** of the buffer in both directions.

**GET_REPORT:**
```c
uint8_t buf[9];          // report_id + 8 declared bytes
buf[0] = 0xF1;           // report ID
int len = hid_get_feature_report(dev, buf, sizeof(buf));
// buf[0] = 0xF1 (report ID)
// buf[1] = enable_rgb
// buf[2] = animation
// buf[3..5] = color (GRB wire order)
// buf[6] = led_count
// buf[7] = brightness
```

**SET_REPORT:**
```c
uint8_t buf[8];           // report_id + 7 data bytes
buf[0] = 0xF2;            // report ID
buf[1] = enable_rgb;
buf[2] = animation;
buf[3] = green;            // wire order
buf[4] = red;              // wire order
buf[5] = blue;             // wire order
buf[6] = led_count;
buf[7] = brightness;
hid_send_feature_report(dev, buf, sizeof(buf));
```

### Linux hidraw

Using the `hidraw` kernel interface with `ioctl`:

**GET_REPORT:**
```c
struct {
    uint8_t report_id;
    uint8_t data[7];
} __attribute__((packed)) report;

report.report_id = 0xF1;
ioctl(fd, HIDIOCGFEATURE(sizeof(report)), &report);
// report.data[0] = enable_rgb
// report.data[1] = animation
// ...
```

**SET_REPORT:**
```c
struct {
    uint8_t report_id;
    uint8_t data[7];
} __attribute__((packed)) report;

report.report_id = 0xF2;
report.data[0] = enable_rgb;
report.data[1] = animation;
// ... fill remaining fields
ioctl(fd, HIDIOCSFEATURE(sizeof(report)), &report);
```

---

## Examples

### WebHID Example

Minimal browser example to connect, read settings, change the color to blue, and apply:

```javascript
// Request device
const [device] = await navigator.hid.requestDevice({
    filters: [{
        vendorId: 0x2E8A,
        productId: 0x1075,
        usagePage: 0xFF00,
        usage: 0x01
    }]
});
await device.open();

// Read current settings
const report = await device.receiveFeatureReport(0xF1);
const enableRgb   = report.getUint8(1);  // skip report ID at byte 0
const animation   = report.getUint8(2);
const wireColor0  = report.getUint8(3);  // green (GRB wire order)
const wireColor1  = report.getUint8(4);  // red
const wireColor2  = report.getUint8(5);  // blue
const ledCount    = report.getUint8(6);
const brightness  = report.getUint8(7);

// Transpose to display RGB
const displayR = wireColor1;
const displayG = wireColor0;
const displayB = wireColor2;
console.log(`Current color: RGB(${displayR}, ${displayG}, ${displayB})`);

// Change to blue: display RGB(0, 0, 255) → wire GRB(0, 0, 255)
const data = new Uint8Array(7);
data[0] = 1;     // enable_rgb
data[1] = 0;     // animation: solid
data[2] = 0;     // wire pos 0 = green = 0
data[3] = 0;     // wire pos 1 = red   = 0
data[4] = 255;   // wire pos 2 = blue  = 255
data[5] = ledCount;
data[6] = brightness;
await device.sendFeatureReport(0xF2, data);

// Save to flash
await device.sendFeatureReport(0xF3, new Uint8Array(7));

// Read board identity
const boardReport = await device.receiveFeatureReport(0xFC);
const bytes = new Uint8Array(boardReport.buffer, boardReport.byteOffset, boardReport.byteLength);
const nullIdx = bytes.indexOf(0);
const board = new TextDecoder().decode(bytes.slice(0, nullIdx > 0 ? nullIdx : bytes.length));
console.log(`Board: ${board}`);
```

### Python hidapi Example

Using the [`hidapi`](https://pypi.org/project/hidapi/) package:

```python
import hid

# Open device
device = hid.device()
device.open(0x2E8A, 0x1075)

# Read current settings (report 0xF1)
buf = device.get_feature_report(0xF1, 9)  # report_id + 8 bytes
enable_rgb  = buf[1]
animation   = buf[2]
wire_g      = buf[3]  # GRB wire order
wire_r      = buf[4]
wire_b      = buf[5]
led_count   = buf[6]
brightness  = buf[7]

# Display as RGB
print(f"Color: RGB({wire_r}, {wire_g}, {wire_b})")

# Set color to red: display RGB(255, 0, 0) → wire GRB(0, 255, 0)
data = [
    0xF2,  # report ID
    1,     # enable_rgb
    0,     # animation: solid
    0,     # wire pos 0 = green = 0
    255,   # wire pos 1 = red   = 255
    0,     # wire pos 2 = blue  = 0
    led_count,
    brightness,
]
device.send_feature_report(data)

# Save to flash
device.send_feature_report([0xF3] + [0] * 7)

# Read board identity (report 0xFC)
buf = device.get_feature_report(0xFC, 65)  # report_id + 64 bytes
board = bytes(buf[1:]).split(b'\x00')[0].decode('utf-8')
print(f"Board: {board}")

device.close()
```

### C hidapi Example

Using [hidapi](https://github.com/libusb/hidapi):

```c
#include <stdio.h>
#include <string.h>
#include <hidapi/hidapi.h>

int main(void) {
    hid_init();

    // Open device
    hid_device *dev = hid_open(0x2E8A, 0x1075, NULL);
    if (!dev) {
        fprintf(stderr, "Failed to open device\n");
        return 1;
    }

    // Read current settings
    uint8_t buf[9] = {0};
    buf[0] = 0xF1;
    int len = hid_get_feature_report(dev, buf, sizeof(buf));
    if (len > 0) {
        printf("RGB Enabled: %d\n", buf[1]);
        printf("Animation:   %d\n", buf[2]);
        // Wire order is GRB; transpose to display RGB
        uint8_t display_r = buf[4];  // wire pos 1 = red
        uint8_t display_g = buf[3];  // wire pos 0 = green
        uint8_t display_b = buf[5];  // wire pos 2 = blue
        printf("Color:       RGB(%d, %d, %d)\n", display_r, display_g, display_b);
        printf("LED Count:   %d\n", buf[6]);
        printf("Brightness:  %d\n", buf[7]);
    }

    // Set color to green: display RGB(0, 255, 0) → wire GRB(255, 0, 0)
    uint8_t set_buf[8] = {0};
    set_buf[0] = 0xF2;   // report ID
    set_buf[1] = 1;       // enable_rgb
    set_buf[2] = 0;       // animation: solid
    set_buf[3] = 255;     // wire pos 0 = green = 255
    set_buf[4] = 0;       // wire pos 1 = red   = 0
    set_buf[5] = 0;       // wire pos 2 = blue  = 0
    set_buf[6] = 64;      // led_count
    set_buf[7] = 64;      // brightness
    hid_send_feature_report(dev, set_buf, sizeof(set_buf));

    // Save to flash
    uint8_t save_buf[8] = {0};
    save_buf[0] = 0xF3;
    hid_send_feature_report(dev, save_buf, sizeof(save_buf));

    // Read board identity
    uint8_t board_buf[65] = {0};
    board_buf[0] = 0xFC;
    len = hid_get_feature_report(dev, board_buf, sizeof(board_buf));
    if (len > 0) {
        printf("Board: %s\n", (char *)&board_buf[1]);
    }

    hid_close(dev);
    hid_exit();
    return 0;
}
```

---

## C Header Definitions

For C/C++ implementations, these are the relevant struct and constant definitions from the firmware:

```c
#define HID_REPORT_ID_SETTINGS_GET          0xF1
#define HID_REPORT_ID_SETTINGS_SET          0xF2
#define HID_REPORT_ID_SETTINGS_SAVE         0xF3
#define HID_REPORT_ID_SETTINGS_RESET        0xF4
#define HID_REPORT_ID_BUTTON_MAP_GET        0xF5  // Reserved
#define HID_REPORT_ID_BUTTON_MAP_SET        0xF6  // Reserved
#define HID_REPORT_ID_SETTINGS_GET_FLASH    0xF7
#define HID_REPORT_ID_BOOTSEL               0xF8
#define HID_REPORT_ID_VERSION               0xF9
#define HID_REPORT_ID_VERSION_FULL          0xFA
#define HID_REPORT_ID_BUILD_TYPE            0xFB
#define HID_REPORT_ID_BOARD                 0xFC

// Settings report: 8 bytes total (1 report ID + 7 data)
typedef struct {
    uint8_t report_id;
    uint8_t enable_rgb;
    uint8_t rgb_animation;
    uint8_t rgb_color_r;     // Wire position 0 (Green in GRB order)
    uint8_t rgb_color_g;     // Wire position 1 (Red in GRB order)
    uint8_t rgb_color_b;     // Wire position 2 (Blue in GRB order)
    uint8_t led_count;
    uint8_t led_brightness;
} __attribute__((packed)) settings_hid_report_t;

// RGB animation types
typedef enum {
    RGB_ANIM_SOLID_COLOR    = 0,
    RGB_ANIM_GRADIENT_FADE  = 1,
} rgb_animation_t;
```

---

## Machine-Readable Config

The full device configuration (report IDs, field definitions, device database, enums, color order) is available as a JSON file at:

**[`https://picoctr.github.io/picoctr-config.json`](https://picoctr.github.io/picoctr-config.json)**

This file is auto-generated from firmware source annotations and is the same config used by the official PicoCTR web configurator. It can be used to build tools dynamically without hardcoding report structures.
