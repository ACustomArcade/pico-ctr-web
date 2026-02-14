/**
 * PicoCTR Web Configurator - Application Logic
 *
 * Handles UI interactions, config loading, and coordinates with the WebUSB layer.
 * Supports RGB settings and per-pin mapping via the vendor bulk JSON protocol.
 */

(function () {
    'use strict';

    // ========================================================================
    // State
    // ========================================================================
    let config = null;
    let picoctr = null;
    let deviceInfo = null;          // from get_info
    let currentSettings = null;
    let flashSettings = null;
    let expanderData = null;        // array of { index, active, pins }

    // Firmware update state
    let picoboot = null;
    let selectedUF2 = null;
    let isFlashing = false;
    let latestRelease = null;
    let installedFwInfo = null;     // from flash read in PICOBOOT mode

    // Color picker state
    let colorPicker = null;
    let liveColorTimer = null;
    const LIVE_COLOR_INTERVAL = 80;

    // ========================================================================
    // DOM References
    // ========================================================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        browserWarning: $('#browser-warning'),
        connectionSection: $('#connection-section'),
        btnConnect: $('#btn-connect'),
        btnDisconnect: $('#btn-disconnect'),
        statusDot: $('.status-dot'),
        statusText: $('.status-text'),
        deviceInfoSection: $('#device-info-section'),
        settingsSection: $('#settings-section'),
        pinMappingSection: $('#pin-mapping-section'),
        actionsSection: $('#actions-section'),
        unsavedBanner: $('#unsaved-banner'),
        logOutput: $('#log-output'),
        // Device info
        infoBoard: $('#info-board'),
        infoVariant: $('#info-variant'),
        infoVersion: $('#info-version'),
        infoBuildType: $('#info-build-type'),
        infoUsbId: $('#info-usb-id'),
        infoGamepads: $('#info-gamepads'),
        // Settings
        enableRgb: $('#setting-enable_rgb'),
        animation: $('#setting-rgb_animation'),
        colorR: $('#setting-rgb_color_r'),
        colorG: $('#setting-rgb_color_g'),
        colorB: $('#setting-rgb_color_b'),
        colorHexDisplay: $('#color-hex-display'),
        ledCount: $('#setting-led_count'),
        brightness: $('#setting-led_brightness'),
        brightnessValue: $('#brightness-value'),
        // Pin mapping
        pinMappingBody: $('#pin-mapping-body'),
        mappingAccordion: $('#button-mapping-accordion'),
        btnMappingExport: $('#btn-mapping-export'),
        btnMappingImport: $('#btn-mapping-import'),
        mappingFileInput: $('#mapping-file-input'),
        // Action buttons
        btnApply: $('#btn-apply'),
        btnRead: $('#btn-read'),
        btnReset: $('#btn-reset'),
        btnUndo: $('#btn-undo'),
        btnBootsel: $('#btn-bootsel'),
        btnClearLog: $('#btn-clear-log'),
        btnBootstrap: $('#btn-bootstrap'),
        bootstrapLink: $('#bootstrap-link'),
        // Apply dialog
        applyDialog: $('#apply-dialog'),
        applyDialogCancel: $('#apply-dialog-cancel'),
        applyDialogConfirm: $('#apply-dialog-confirm'),
        applyDialogSave: $('#apply-dialog-save'),
        // Color group
        colorGroup: $('#color-group'),
        // Firmware update
        firmwareSection: $('#firmware-section'),
        btnFwConnect: $('#btn-fw-connect'),
        fwDeviceInfo: $('#fw-device-info'),
        fwDeviceName: $('#fw-device-name'),
        fwFileInput: $('#fw-file-input'),
        btnFwBrowse: $('#btn-fw-browse'),
        fwFileInfo: $('#fw-file-info'),
        fwInfoSize: $('#fw-info-size'),
        fwInfoBoard: $('#fw-info-board'),
        fwInfoVariant: $('#fw-info-variant'),
        fwInfoVersion: $('#fw-info-version'),
        fwInfoGit: $('#fw-info-git'),
        fwInfoRowBoard: $('#fw-info-row-board'),
        fwInfoRowVariant: $('#fw-info-row-variant'),
        fwInfoRowVersion: $('#fw-info-row-version'),
        fwInfoRowGit: $('#fw-info-row-git'),
        fwValidationWarning: $('#fw-validation-warning'),
        // Installed firmware info (read from flash)
        fwInstalledInfo: $('#fw-installed-info'),
        fwInstalledLoading: $('#fw-installed-loading'),
        fwInstalledVariant: $('#fw-installed-variant'),
        fwInstalledBoard: $('#fw-installed-board'),
        fwInstalledVersion: $('#fw-installed-version'),
        fwInstalledGit: $('#fw-installed-git'),
        fwInstalledRowVariant: $('#fw-installed-row-variant'),
        fwInstalledRowBoard: $('#fw-installed-row-board'),
        fwInstalledRowVersion: $('#fw-installed-row-version'),
        fwInstalledRowGit: $('#fw-installed-row-git'),
        btnFwFlash: $('#btn-fw-flash'),
        fwProgressContainer: $('#fw-progress-container'),
        fwProgressFill: $('#fw-progress-fill'),
        fwProgressText: $('#fw-progress-text'),
        fwStepConnect: $('#fw-step-connect'),
        fwStepFile: $('#fw-step-file'),
        fwStepFlash: $('#fw-step-flash'),
        fwConnectStatus: $('#fw-connect-status'),
        fwReleaseLoading: $('#fw-release-loading'),
        fwReleaseError: $('#fw-release-error'),
        fwReleaseErrorMsg: $('#fw-release-error-msg'),
        fwReleaseContent: $('#fw-release-content'),
        fwReleaseTag: $('#fw-release-tag'),
        fwReleaseDate: $('#fw-release-date'),
        fwReleaseList: $('#fw-release-list'),
        btnFwReturn: $('#btn-fw-return'),
    };

    // ========================================================================
    // Logging
    // ========================================================================
    function log(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${level}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
        dom.logOutput.appendChild(entry);
        dom.logOutput.scrollTop = dom.logOutput.scrollHeight;
    }

    // ========================================================================
    // Config Loading
    // ========================================================================
    async function loadConfig() {
        try {
            const resp = await fetch('picoctr-config.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            config = await resp.json();
            log(`Loaded config v${config.version} (${config.devices.length} devices)`, 'success');
            return true;
        } catch (err) {
            log(`Failed to load config: ${err.message}`, 'error');
            return false;
        }
    }

    // ========================================================================
    // UI Helpers
    // ========================================================================
    function setConnected(isConnected) {
        dom.statusDot.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
        dom.statusText.textContent = isConnected ? 'Connected' : 'Not connected';
        dom.btnConnect.style.display = isConnected ? 'none' : '';
        dom.btnDisconnect.style.display = isConnected ? '' : 'none';
        dom.deviceInfoSection.style.display = isConnected ? '' : 'none';
        dom.settingsSection.style.display = isConnected ? '' : 'none';
        dom.pinMappingSection.style.display = isConnected ? '' : 'none';
        dom.actionsSection.style.display = isConnected ? '' : 'none';
        if (dom.bootstrapLink) dom.bootstrapLink.style.display = isConnected ? 'none' : '';

        [dom.btnApply, dom.btnRead, dom.btnReset, dom.btnUndo, dom.btnBootsel].forEach(btn => {
            if (btn) btn.disabled = !isConnected;
        });
    }

    function populateAnimationSelect() {
        const select = dom.animation;
        select.innerHTML = '';
        const options = picoctr.getEnumOptions('animations');
        for (const opt of options) {
            const el = document.createElement('option');
            el.value = opt.id;
            el.textContent = opt.label;
            select.appendChild(el);
        }
    }

    function updateUIFromSettings(settings) {
        if (!settings) return;
        currentSettings = { ...settings };

        dom.enableRgb.checked = !!settings.enable_rgb;
        dom.animation.value = settings.rgb_animation || 0;

        const r = settings.rgb_r || 0;
        const g = settings.rgb_g || 0;
        const b = settings.rgb_b || 0;
        dom.colorR.value = r;
        dom.colorG.value = g;
        dom.colorB.value = b;
        dom.colorHexDisplay.textContent = rgbToHex(r, g, b);
        if (colorPicker) {
            colorPicker.color.rgb = { r, g, b };
        }

        dom.ledCount.value = settings.led_count || 64;
        dom.brightness.value = settings.led_brightness || 0;
        dom.brightnessValue.textContent = settings.led_brightness || 0;
    }

    function getSettingsFromUI() {
        return {
            enable_rgb: dom.enableRgb.checked ? 1 : 0,
            rgb_animation: parseInt(dom.animation.value) || 0,
            rgb_r: parseInt(dom.colorR.value) || 0,
            rgb_g: parseInt(dom.colorG.value) || 0,
            rgb_b: parseInt(dom.colorB.value) || 0,
            led_count: parseInt(dom.ledCount.value) || 64,
            led_brightness: parseInt(dom.brightness.value) || 0,
        };
    }

    const fieldDomMap = {
        enable_rgb:      () => [dom.enableRgb],
        rgb_animation:   () => [dom.animation],
        rgb_r:           () => [dom.colorR, dom.colorG, dom.colorB],
        rgb_g:           () => [dom.colorR, dom.colorG, dom.colorB],
        rgb_b:           () => [dom.colorR, dom.colorG, dom.colorB],
        led_count:       () => [dom.ledCount],
        led_brightness:  () => [dom.brightness],
    };

    function checkUnsavedChanges() {
        document.querySelectorAll('.field-modified').forEach(el =>
            el.classList.remove('field-modified')
        );

        if (!flashSettings) {
            dom.unsavedBanner.style.display = 'none';
            return;
        }

        const uiSettings = getSettingsFromUI();
        const settingsKeys = ['enable_rgb', 'rgb_animation', 'rgb_r', 'rgb_g', 'rgb_b', 'led_count', 'led_brightness'];
        const changedFields = [];

        for (const key of settingsKeys) {
            if (uiSettings[key] !== flashSettings[key]) {
                changedFields.push(key);
                const elements = fieldDomMap[key]?.() || [];
                const groups = new Set();
                for (const el of elements) {
                    const group = el?.closest('.form-group');
                    if (group) groups.add(group);
                }
                groups.forEach(g => g.classList.add('field-modified'));
            }
        }

        if (changedFields.length > 0) {
            dom.unsavedBanner.style.display = '';
            dom.unsavedBanner.innerHTML =
                '<span>⚡ Device has unsaved changes &mdash; use <strong>Save to Flash</strong> to persist them</span>';
        } else {
            dom.unsavedBanner.style.display = 'none';
        }
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    function updateColorGroupVisibility() {
        const isSolid = parseInt(dom.animation.value) === 0;
        dom.colorGroup.style.display = isSolid ? '' : 'none';
    }

    // ========================================================================
    // Button Mapping UI
    // ========================================================================

    function renderPinMappingTable() {
        if (!expanderData || !dom.pinMappingBody) return;

        const pmConfig = config.pin_mapping;
        const hasKbd = picoctr.hasKeyboardSupport();
        const hasMouse = picoctr.hasMouseSupport();
        const numGamepads = deviceInfo ? deviceInfo.numGamepads : 4;

        // Flatten all labeled pins from all active expanders into one list
        const allButtons = [];
        for (const exp of expanderData) {
            if (!exp.active) continue;
            exp.pins.forEach((pin, pinIdx) => {
                if (pin.label && pin.label.trim()) {
                    allButtons.push({ expIdx: exp.index, pinIdx, pin });
                }
            });
        }

        dom.pinMappingBody.innerHTML = '';

        if (allButtons.length === 0) {
            dom.pinMappingBody.innerHTML = '<tr><td colspan="4" class="pin-empty">No mapped buttons</td></tr>';
            return;
        }

        // Sort buttons alphabetically by label
        allButtons.sort((a, b) => a.pin.label.localeCompare(b.pin.label));

        // Update accordion hint with count
        const hint = dom.mappingAccordion?.querySelector('.accordion-hint');
        if (hint) hint.textContent = `${allButtons.length} buttons`;

        for (const { expIdx, pinIdx, pin } of allButtons) {
            const row = document.createElement('tr');
            row.className = 'pin-row';

            // Button name (label)
            const tdLabel = document.createElement('td');
            tdLabel.className = 'pin-label';
            tdLabel.textContent = pin.label;
            row.appendChild(tdLabel);

            // Output Type select
            const tdType = document.createElement('td');
            const selType = document.createElement('select');
            selType.className = 'pin-select';
            selType.dataset.expander = expIdx;
            selType.dataset.pin = pinIdx;
            selType.dataset.field = 'output_type';
            for (const ot of pmConfig.output_types) {
                if (ot.value === 3 && !hasKbd) continue;
                if (ot.value === 4 && !hasMouse) continue;
                const opt = document.createElement('option');
                opt.value = ot.value;
                opt.textContent = ot.label;
                selType.appendChild(opt);
            }
            selType.value = pin.output_type;
            selType.addEventListener('change', () => onPinFieldChange(expIdx, pinIdx, 'output_type', parseInt(selType.value)));
            tdType.appendChild(selType);
            row.appendChild(tdType);

            // Output Target select
            const tdTarget = document.createElement('td');
            const selTarget = document.createElement('select');
            selTarget.className = 'pin-select';
            selTarget.dataset.field = 'output_target';
            if (pin.output_type === 1 || pin.output_type === 2) {
                for (let p = 0; p < numGamepads; p++) {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = `Player ${p + 1}`;
                    selTarget.appendChild(opt);
                }
            } else {
                const opt = document.createElement('option');
                opt.value = 0;
                opt.textContent = '\u2014';
                selTarget.appendChild(opt);
            }
            selTarget.value = pin.output_target;
            selTarget.disabled = pin.output_type === 0;
            selTarget.addEventListener('change', () => onPinFieldChange(expIdx, pinIdx, 'output_target', parseInt(selTarget.value)));
            tdTarget.appendChild(selTarget);
            row.appendChild(tdTarget);

            // Output Code select
            const tdCode = document.createElement('td');
            const selCode = document.createElement('select');
            selCode.className = 'pin-select';
            selCode.dataset.field = 'output_code';
            populateCodeOptions(selCode, pin.output_type);
            selCode.value = pin.output_code;
            selCode.disabled = pin.output_type === 0;
            selCode.addEventListener('change', () => onPinFieldChange(expIdx, pinIdx, 'output_code', parseInt(selCode.value)));
            tdCode.appendChild(selCode);
            row.appendChild(tdCode);

            dom.pinMappingBody.appendChild(row);
        }
    }

    function populateCodeOptions(select, outputType) {
        select.innerHTML = '';
        const pmConfig = config.pin_mapping;

        switch (outputType) {
            case 0: { // Disabled
                const opt = document.createElement('option');
                opt.value = 0;
                opt.textContent = '—';
                select.appendChild(opt);
                break;
            }
            case 1: { // Gamepad button
                for (const btn of pmConfig.gamepad_buttons) {
                    const opt = document.createElement('option');
                    opt.value = btn.idx;
                    opt.textContent = btn.label;
                    select.appendChild(opt);
                }
                break;
            }
            case 2: { // D-pad
                for (const dir of pmConfig.dpad_directions) {
                    const opt = document.createElement('option');
                    opt.value = dir.idx;
                    opt.textContent = dir.label;
                    select.appendChild(opt);
                }
                break;
            }
            case 3: { // Keyboard
                // Common keyboard keys
                const commonKeys = [
                    [0x04, 'A'], [0x05, 'B'], [0x06, 'C'], [0x07, 'D'],
                    [0x08, 'E'], [0x09, 'F'], [0x0A, 'G'], [0x0B, 'H'],
                    [0x0C, 'I'], [0x0D, 'J'], [0x0E, 'K'], [0x0F, 'L'],
                    [0x10, 'M'], [0x11, 'N'], [0x12, 'O'], [0x13, 'P'],
                    [0x14, 'Q'], [0x15, 'R'], [0x16, 'S'], [0x17, 'T'],
                    [0x18, 'U'], [0x19, 'V'], [0x1A, 'W'], [0x1B, 'X'],
                    [0x1C, 'Y'], [0x1D, 'Z'],
                    [0x1E, '1'], [0x1F, '2'], [0x20, '3'], [0x21, '4'],
                    [0x22, '5'], [0x23, '6'], [0x24, '7'], [0x25, '8'],
                    [0x26, '9'], [0x27, '0'],
                    [0x28, 'Enter'], [0x29, 'Escape'], [0x2A, 'Backspace'],
                    [0x2B, 'Tab'], [0x2C, 'Space'],
                    [0x3A, 'F1'], [0x3B, 'F2'], [0x3C, 'F3'], [0x3D, 'F4'],
                    [0x3E, 'F5'], [0x3F, 'F6'], [0x40, 'F7'], [0x41, 'F8'],
                    [0x42, 'F9'], [0x43, 'F10'], [0x44, 'F11'], [0x45, 'F12'],
                    [0x4F, 'Right Arrow'], [0x50, 'Left Arrow'],
                    [0x51, 'Down Arrow'], [0x52, 'Up Arrow'],
                    [0xE0, 'Left Ctrl'], [0xE1, 'Left Shift'],
                    [0xE2, 'Left Alt'], [0xE3, 'Left GUI'],
                    [0xE4, 'Right Ctrl'], [0xE5, 'Right Shift'],
                    [0xE6, 'Right Alt'], [0xE7, 'Right GUI'],
                ];
                for (const [code, label] of commonKeys) {
                    const opt = document.createElement('option');
                    opt.value = code;
                    opt.textContent = `${label} (0x${code.toString(16).toUpperCase().padStart(2, '0')})`;
                    select.appendChild(opt);
                }
                break;
            }
            case 4: { // Mouse button
                for (const btn of pmConfig.mouse_buttons) {
                    const opt = document.createElement('option');
                    opt.value = btn.idx;
                    opt.textContent = btn.label;
                    select.appendChild(opt);
                }
                break;
            }
        }
    }

    function onPinFieldChange(expIdx, pinIdx, field, value) {
        if (!expanderData) return;
        const exp = expanderData.find(e => e.index === expIdx);
        if (!exp) return;

        const pin = exp.pins[pinIdx];
        if (field === 'output_type') {
            pin.output_type = value;
            // Reset target and code when type changes
            pin.output_target = 0;
            pin.output_code = 0;
            // Re-render the row to update dependent selects
            renderPinMappingTable();
        } else if (field === 'output_target') {
            pin.output_target = value;
        } else if (field === 'output_code') {
            pin.output_code = value;
        }
    }

    async function applyPinMapping() {
        if (!expanderData || !picoctr || !picoctr.connected) return;

        try {
            log('Applying pin mappings to device...');
            for (const exp of expanderData) {
                if (!exp.active) continue;
                const fwPins = exp.pins.map(p => ({
                    t: p.output_type,
                    tg: p.output_target,
                    c: p.output_code,
                }));
                await picoctr.setPinMap(exp.index, fwPins);
            }
            log('Pin mappings applied (not saved to flash)', 'success');
        } catch (err) {
            log(`Failed to apply pin mappings: ${err.message}`, 'error');
        }
    }

    // ========================================================================
    // Mapping Import / Export
    // ========================================================================

    function exportMapping() {
        if (!expanderData) {
            log('No mapping data to export', 'error');
            return;
        }

        const exportData = {
            version: 1,
            board: deviceInfo ? deviceInfo.board : 'unknown',
            variant: deviceInfo ? deviceInfo.variant : 'unknown',
            firmware: deviceInfo ? deviceInfo.version : 'unknown',
            exported: new Date().toISOString(),
            expanders: expanderData
                .filter(e => e.active)
                .map(exp => ({
                    index: exp.index,
                    pins: exp.pins.map(p => ({
                        label: p.label || '',
                        output_type: p.output_type,
                        output_target: p.output_target,
                        output_code: p.output_code,
                    })),
                })),
        };

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const board = (deviceInfo?.board || 'picoctr').replace(/\s+/g, '-').toLowerCase();
        a.download = `${board}-mapping.json`;
        a.click();
        URL.revokeObjectURL(url);

        log('Mapping exported', 'success');
    }

    function handleMappingImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importData = JSON.parse(e.target.result);

                if (!importData.expanders || !Array.isArray(importData.expanders)) {
                    throw new Error('Invalid mapping file: missing expanders array');
                }

                if (!expanderData) {
                    throw new Error('Connect to a device and load mappings first');
                }

                // Warn if mapping was exported from a different board type
                if (importData.board && deviceInfo && deviceInfo.board &&
                    importData.board !== deviceInfo.board) {
                    const proceed = confirm(
                        `This mapping was exported from a different board type:\n\n` +
                        `  Mapping: ${importData.board}\n` +
                        `  Device:  ${deviceInfo.board}\n\n` +
                        `Button positions may not match. Import anyway?`
                    );
                    if (!proceed) {
                        log('Import cancelled (board mismatch)', 'warning');
                        return;
                    }
                }

                let applied = 0;
                for (const impExp of importData.expanders) {
                    const localExp = expanderData.find(ex => ex.index === impExp.index);
                    if (!localExp || !localExp.active) continue;

                    for (let i = 0; i < impExp.pins.length && i < localExp.pins.length; i++) {
                        const src = impExp.pins[i];
                        const dst = localExp.pins[i];
                        // Only overwrite functional fields, preserve label from device
                        dst.output_type = src.output_type ?? 0;
                        dst.output_target = src.output_target ?? 0;
                        dst.output_code = src.output_code ?? 0;
                        applied++;
                    }
                }

                renderPinMappingTable();
                log(`Imported mapping (${applied} pins). Click Apply to send to device.`, 'success');
            } catch (err) {
                log(`Import failed: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);

        // Reset input so the same file can be re-imported
        event.target.value = '';
    }

    // ========================================================================
    // Connection
    // ========================================================================
    async function handleConnect() {
        try {
            log('Requesting device connection...');
            const info = await picoctr.connect();
            log(`Connected to ${info.productName || 'PicoCTR device'}`, 'success');
            setConnected(true);

            const vid = info.vendorId.toString(16).padStart(4, '0').toUpperCase();
            const pid = info.productId.toString(16).padStart(4, '0').toUpperCase();
            dom.infoUsbId.textContent = `${vid}:${pid}`;

            picoctr.onDisconnect(() => {
                log('Device disconnected', 'warning');
                setConnected(false);
                currentSettings = null;
                flashSettings = null;
                expanderData = null;
                deviceInfo = null;
                document.querySelectorAll('.field-modified').forEach(el =>
                    el.classList.remove('field-modified')
                );
                dom.unsavedBanner.style.display = 'none';
            });

            await readDeviceInfo();
            await readSettings();
            await readPinMappings();
            // Check for firmware updates in the background
            checkFirmwareUpdate();
        } catch (err) {
            if (err.message === 'No device selected') {
                log('Connection cancelled by user', 'warning');
            } else {
                log(`Connection failed: ${err.message}`, 'error');
            }
        }
    }

    async function handleDisconnect() {
        try {
            await picoctr.disconnect();
            log('Disconnected');
            setConnected(false);
            currentSettings = null;
            flashSettings = null;
            expanderData = null;
            deviceInfo = null;
            document.querySelectorAll('.field-modified').forEach(el =>
                el.classList.remove('field-modified')
            );
            dom.unsavedBanner.style.display = 'none';
        } catch (err) {
            log(`Disconnect error: ${err.message}`, 'error');
        }
    }

    // ========================================================================
    // Version Comparison
    // ========================================================================

    /**
     * Parse a version string like "1.0.8", "2.0.0-rc1", "v2.0.0-rc1".
     * Returns { major, minor, patch, pre } where pre is the prerelease string or null.
     */
    function parseVersion(v) {
        if (!v || typeof v !== 'string') return null;
        v = v.replace(/^v/i, '').trim();
        const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
        if (!m) return null;
        return {
            major: parseInt(m[1], 10),
            minor: parseInt(m[2], 10),
            patch: parseInt(m[3], 10),
            pre: m[4] || null,
            raw: v,
        };
    }

    /**
     * Compare two version strings. Returns:
     *  -1 if a < b, 0 if equal, 1 if a > b.
     * Prerelease versions are considered older than the same version without prerelease.
     */
    function compareVersions(a, b) {
        const pa = parseVersion(a);
        const pb = parseVersion(b);
        if (!pa || !pb) return 0;  // can't compare, treat as equal

        for (const k of ['major', 'minor', 'patch']) {
            if (pa[k] < pb[k]) return -1;
            if (pa[k] > pb[k]) return 1;
        }
        // Same base version — release > prerelease
        if (!pa.pre && pb.pre) return 1;   // a is release, b is prerelease
        if (pa.pre && !pb.pre) return -1;  // a is prerelease, b is release
        if (pa.pre && pb.pre) {
            return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
        }
        return 0;
    }

    /**
     * After connecting, check if a newer firmware is available and prompt the user.
     */
    async function checkFirmwareUpdate() {
        if (!deviceInfo || !deviceInfo.version) return;
        try {
            const manifest = await PicoCTRFirmwareReleases.loadManifest();
            const { version } = PicoCTRFirmwareReleases.buildAssetList(manifest);

            const latestVersion = parseVersion(version);
            if (!latestVersion) return;

            const cmp = compareVersions(deviceInfo.version, version);
            if (cmp < 0) {
                log(`Firmware update available: ${latestVersion.raw} (device has ${deviceInfo.version})`, 'warning');
                const update = confirm(
                    `A firmware update is available!\n\n` +
                    `  Installed:  v${deviceInfo.version}\n` +
                    `  Available:  v${latestVersion.raw}\n\n` +
                    `Would you like to update now?`
                );
                if (update) {
                    await enterBootsel();
                }
            }
        } catch {
            // Silently ignore — manifest may not be available
        }
    }

    // ========================================================================
    // Device Info
    // ========================================================================
    async function readDeviceInfo() {
        try {
            deviceInfo = await picoctr.getDeviceInfo();
            dom.infoBoard.textContent = deviceInfo.board || '—';
            dom.infoVariant.textContent = deviceInfo.variant || '—';
            dom.infoVersion.textContent = deviceInfo.versionFull || deviceInfo.version || '—';
            dom.infoBuildType.textContent = deviceInfo.buildType || '—';
            if (dom.infoGamepads) dom.infoGamepads.textContent = deviceInfo.numGamepads || '—';

            log(`Board: ${deviceInfo.board}, Variant: ${deviceInfo.variant}, FW: ${deviceInfo.version} (${deviceInfo.buildType}), Gamepads: ${deviceInfo.numGamepads}`, 'info');
        } catch (err) {
            log(`Failed to read device info: ${err.message}`, 'error');
        }
    }

    // ========================================================================
    // Settings Operations
    // ========================================================================
    async function readSettings() {
        try {
            log('Reading settings from device...');
            const [settings, flash] = await Promise.all([
                picoctr.getSettings(),
                picoctr.getFlashSettings(),
            ]);

            const normalize = (s) => ({
                enable_rgb: s.enable_rgb ? 1 : 0,
                rgb_animation: s.rgb_animation || 0,
                rgb_r: s.rgb_r || 0,
                rgb_g: s.rgb_g || 0,
                rgb_b: s.rgb_b || 0,
                led_count: s.led_count || 64,
                led_brightness: s.led_brightness || 0,
            });

            currentSettings = normalize(settings);
            flashSettings = normalize(flash);

            updateUIFromSettings(currentSettings);
            updateColorGroupVisibility();
            checkUnsavedChanges();

            if (JSON.stringify(currentSettings) !== JSON.stringify(flashSettings)) {
                log('Device has unsaved settings that differ from flash', 'warning');
            }

            log('Settings loaded successfully', 'success');
        } catch (err) {
            log(`Failed to read settings: ${err.message}`, 'error');
        }
    }

    async function readPinMappings() {
        try {
            log('Reading pin mappings from device...');
            const numExp = deviceInfo ? deviceInfo.numExpanders : 4;
            expanderData = await picoctr.loadAllExpanders(numExp);

            const activeCount = expanderData.filter(e => e.active).length;
            const labeledCount = expanderData
                .filter(e => e.active)
                .reduce((n, e) => n + e.pins.filter(p => p.label && p.label.trim()).length, 0);
            log(`Loaded ${labeledCount} button(s) from ${activeCount} expander(s)`, 'success');

            renderPinMappingTable();
        } catch (err) {
            log(`Failed to read pin mappings: ${err.message}`, 'error');
        }
    }

    function showApplyDialog() {
        dom.applyDialog.showModal();
    }

    async function applySettings() {
        try {
            const settings = getSettingsFromUI();
            log('Applying settings to device...');
            await picoctr.setSettings(settings);
            currentSettings = { ...settings };

            // Also apply pin mapping changes
            await applyPinMapping();

            checkUnsavedChanges();
            log('Settings applied (not saved to flash)', 'success');
        } catch (err) {
            log(`Failed to apply settings: ${err.message}`, 'error');
        }
    }

    async function saveSettings() {
        try {
            const settings = getSettingsFromUI();
            await picoctr.setSettings(settings);
            await applyPinMapping();

            log('Saving all settings to flash...');
            await picoctr.save();

            await new Promise(r => setTimeout(r, 500));
            await readSettings();
            log('Settings saved to flash!', 'success');
        } catch (err) {
            log(`Failed to save settings: ${err.message}`, 'error');
        }
    }

    async function resetSettings() {
        if (!confirm('Reset all settings to factory defaults? This will save immediately.')) {
            return;
        }
        try {
            log('Resetting to defaults...');
            await picoctr.reset();
            await new Promise(r => setTimeout(r, 500));
            await readSettings();
            await readPinMappings();
            log('Settings reset to defaults', 'success');
        } catch (err) {
            log(`Failed to reset settings: ${err.message}`, 'error');
        }
    }

    async function undoChanges() {
        if (!confirm('Undo all pending changes?\n\nThe device will reboot and reload saved settings.\nAny unsaved changes will be lost.')) {
            return;
        }
        try {
            log('Rebooting device to undo changes...');
            await picoctr.reboot();
            log('Device is rebooting...', 'warning');
        } catch (err) {
            log('Device is rebooting...', 'warning');
        }
        setConnected(false);
        // Give device time to reboot, then prompt reconnect
        await new Promise(r => setTimeout(r, 2000));
        log('Device rebooted. Please reconnect.', 'info');
    }

    async function enterBootsel() {
        if (!confirm('Update firmware?\n\nThe device will disconnect and reboot into flash mode.\nYou can then flash a new firmware via the Firmware Update section below.')) {
            return;
        }
        try {
            log('Entering flash mode...');
            await picoctr.enterBootsel();
            log('Device entered flash mode.', 'warning');
        } catch (err) {
            log('Device entered flash mode.', 'warning');
        }
        showFirmwareSection();
        await handleFwConnect();
    }

    // ========================================================================
    // Firmware Update
    // ========================================================================

    function showFirmwareSection() {
        dom.connectionSection.style.display = 'none';
        dom.firmwareSection.style.display = '';
        resetFirmwareUI();
    }

    async function handleBootstrap() {
        log('Bootstrap mode: looking for device in flash mode...', 'info');
        showFirmwareSection();
        await handleFwConnect();
    }

    function hideFirmwareSection() {
        dom.firmwareSection.style.display = 'none';
        dom.connectionSection.style.display = '';
        resetFirmwareUI();
    }

    async function returnToConfigMode() {
        if (picoboot) {
            try {
                log('Rebooting device to normal mode...', 'info');
                dom.btnFwReturn.disabled = true;
                await picoboot.rebootToNormal();
                log('Device is rebooting. It will re-appear as a HID device.', 'success');
            } catch (err) {
                // Errors are expected — the device disconnects immediately on reboot
                log('Reboot command sent.', 'info');
            }
        }
        hideFirmwareSection();
    }

    function resetFirmwareUI() {
        dom.fwDeviceInfo.style.display = 'none';
        dom.fwDeviceName.textContent = '—';
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwBrowse.disabled = true;
        selectedUF2 = null;
        installedFwInfo = null;

        // Reset installed firmware info
        if (dom.fwInstalledInfo) dom.fwInstalledInfo.style.display = 'none';
        if (dom.fwInstalledLoading) dom.fwInstalledLoading.style.display = '';
        if (dom.fwInstalledRowVariant) dom.fwInstalledRowVariant.style.display = 'none';
        if (dom.fwInstalledRowBoard) dom.fwInstalledRowBoard.style.display = 'none';
        if (dom.fwInstalledRowVersion) dom.fwInstalledRowVersion.style.display = 'none';
        if (dom.fwInstalledRowGit) dom.fwInstalledRowGit.style.display = 'none';

        if (dom.fwReleaseLoading) dom.fwReleaseLoading.style.display = '';
        if (dom.fwReleaseError) dom.fwReleaseError.style.display = 'none';
        if (dom.fwReleaseContent) dom.fwReleaseContent.style.display = 'none';
        if (dom.fwReleaseList) dom.fwReleaseList.innerHTML = '';

        dom.btnFwFlash.disabled = true;
        dom.btnFwReturn.disabled = false;
        dom.btnFwConnect.style.display = '';
        dom.btnFwConnect.disabled = false;
        dom.fwProgressContainer.style.display = 'none';
        dom.fwProgressFill.style.width = '0%';
        dom.fwProgressFill.className = 'fw-progress-fill';
        dom.fwProgressText.textContent = 'Waiting...';

        setFirmwareStepState(dom.fwStepConnect, 'active');
        setFirmwareStepState(dom.fwStepFile, '');
        setFirmwareStepState(dom.fwStepFlash, '');

        // Re-hide steps 2 and 3 until device is connected
        if (dom.fwStepFile) dom.fwStepFile.classList.add('fw-step-hidden');
        if (dom.fwStepFlash) dom.fwStepFlash.classList.add('fw-step-hidden');

        if (picoboot) {
            picoboot.disconnect().catch(() => {});
            picoboot = null;
        }
    }

    function setFirmwareStepState(stepEl, state) {
        if (!stepEl) return;
        stepEl.classList.remove('step-active', 'step-complete');
        if (state === 'active') stepEl.classList.add('step-active');
        if (state === 'complete') stepEl.classList.add('step-complete');
    }

    function _isWindowsDriverError(err) {
        const isWindows = navigator.userAgent.includes('Windows');
        const isDriverError = err.name === 'SecurityError' ||
            err.name === 'NetworkError' ||
            err.message?.includes('Unable to claim interface') ||
            err.message?.includes('Access denied') ||
            err.message?.includes('failed to claim');
        return isWindows && isDriverError;
    }

    function _setConnectStatus(message, type = '') {
        if (!dom.fwConnectStatus) return;
        if (!message) {
            dom.fwConnectStatus.style.display = 'none';
            dom.fwConnectStatus.textContent = '';
            dom.fwConnectStatus.className = 'fw-connect-status';
            return;
        }
        dom.fwConnectStatus.textContent = message;
        dom.fwConnectStatus.className = 'fw-connect-status';
        if (type) dom.fwConnectStatus.classList.add('fw-connect-status--' + type);
        dom.fwConnectStatus.style.display = '';
    }

    async function handleFwConnect() {
        if (!PicobootConnection.isSupported()) {
            _setConnectStatus('WebUSB is not supported in this browser.', 'error');
            log('WebUSB is not supported in this browser', 'error');
            return;
        }

        try {
            _setConnectStatus('Waiting for device selection...', 'info');
            dom.btnFwConnect.disabled = true;
            picoboot = new PicobootConnection();

            const device = await picoboot.connect();
            const name = device.productName || 'RP2040';
            dom.fwDeviceInfo.style.display = '';
            dom.fwDeviceName.textContent = name;
            dom.btnFwBrowse.disabled = false;
            dom.btnFwConnect.style.display = 'none';
            _setConnectStatus('');

            setFirmwareStepState(dom.fwStepConnect, 'complete');
            setFirmwareStepState(dom.fwStepFile, 'active');
            dom.fwStepFile.classList.remove('fw-step-hidden');

            log(`Device connected: ${name}`, 'success');
            loadFirmwareList();

            // Read installed firmware info from flash (non-blocking)
            readInstalledFirmware();

            picoboot.onDisconnect(() => {
                log('Device disconnected from flash mode', 'warning');
                if (!isFlashing) {
                    resetFirmwareUI();
                }
            });
        } catch (err) {
            if (err.name === 'NotFoundError' || err.message?.includes('No device selected')) {
                _setConnectStatus('Device selection cancelled. Click Connect to try again.', 'info');
            } else if (_isWindowsDriverError(err)) {
                _setConnectStatus(
                    'Could not connect: Windows needs the WinUSB driver installed. ' +
                    'See the driver setup instructions below, then unplug and re-plug the device.',
                    'error'
                );
                const winHelp = document.getElementById('fw-windows-help');
                if (winHelp) winHelp.style.display = '';
            } else {
                _setConnectStatus('Connection failed: ' + err.message, 'error');
                log(`Connection failed: ${err.message}`, 'error');
            }
            picoboot = null;
        } finally {
            dom.btnFwConnect.disabled = false;
        }
    }

    async function readInstalledFirmware() {
        if (!picoboot) return;

        dom.fwInstalledInfo.style.display = '';
        dom.fwInstalledLoading.style.display = '';

        try {
            const info = await picoboot.readInstalledFirmwareInfo();
            installedFwInfo = info;
            dom.fwInstalledLoading.style.display = 'none';

            if (info.variant) {
                dom.fwInstalledVariant.textContent = info.variant;
                dom.fwInstalledRowVariant.style.display = '';
            }
            if (info.board) {
                dom.fwInstalledBoard.textContent = info.board;
                dom.fwInstalledRowBoard.style.display = '';
            }
            if (info.version) {
                dom.fwInstalledVersion.textContent = info.version;
                dom.fwInstalledRowVersion.style.display = '';
            }
            if (info.git) {
                dom.fwInstalledGit.textContent = info.git;
                dom.fwInstalledRowGit.style.display = '';
            }

            if (info.isPicoCTR) {
                const parts = [];
                if (info.variant) parts.push(info.variant);
                else if (info.board) parts.push(info.board);
                if (info.version) parts.push(`v${info.version}`);
                log(`Installed firmware: ${parts.join(', ')}`, 'info');
            } else {
                log('Could not identify installed firmware', 'warning');
            }
        } catch (err) {
            dom.fwInstalledLoading.style.display = 'none';
            log(`Could not read installed firmware: ${err.message}`, 'warning');
        }
    }

    function displayUF2Info(info, name) {
        if (info.board) {
            dom.fwInfoBoard.textContent = info.board;
            dom.fwInfoRowBoard.style.display = '';
        } else {
            dom.fwInfoRowBoard.style.display = 'none';
        }
        if (info.variant) {
            dom.fwInfoVariant.textContent = info.variant;
            dom.fwInfoRowVariant.style.display = '';
        } else {
            dom.fwInfoRowVariant.style.display = 'none';
        }
        if (info.version) {
            dom.fwInfoVersion.textContent = info.version;
            dom.fwInfoRowVersion.style.display = '';
        } else {
            dom.fwInfoRowVersion.style.display = 'none';
        }
        // Hide git info in UF2 details — version is sufficient
        dom.fwInfoRowGit.style.display = 'none';

        dom.fwInfoSize.textContent = formatBytes(info.totalSize);
        dom.fwFileInfo.style.display = '';

        // TODO: re-enable PicoCTR firmware validation once binary info markers
        // are stable across all build variants.
        // if (!info.isPicoCTR) {
        //     dom.fwFileInfo.style.display = 'none';
        //     dom.fwValidationWarning.style.display = '';
        //     log(`Error: "${name}" does not appear to be PicoCTR firmware`, 'error');
        //     return null;
        // }

        dom.fwValidationWarning.style.display = 'none';

        // Warn if firmware variant doesn't match the installed firmware
        const currentVariant = installedFwInfo?.variant || deviceInfo?.variant;
        if (info.variant && currentVariant && info.variant !== currentVariant) {
            dom.fwValidationWarning.textContent =
                `Warning: This firmware is for "${info.variant}" but your device ` +
                `is currently running "${currentVariant}". You can still flash ` +
                `it to switch variants, but make sure this is the correct firmware ` +
                `for your hardware.`;
            dom.fwValidationWarning.style.display = '';
            log(`Variant mismatch: firmware="${info.variant}", device="${currentVariant}"`, 'warning');
        }

        const parts = [];
        if (info.variant) parts.push(info.variant);
        else if (info.board) parts.push(info.board);
        if (info.version) parts.push(`v${info.version}`);
        parts.push(formatBytes(info.totalSize));
        return parts.join(', ');
    }

    function handleFwFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (dom.fwReleaseList) {
            dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => el.classList.remove('selected'));
        }

        selectedUF2 = null;
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwFlash.disabled = true;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = reader.result;
                const info = PicobootConnection.getUF2Info(data);
                const summary = displayUF2Info(info, file.name);
                if (!summary) {
                    selectedUF2 = null;
                    return;
                }

                selectedUF2 = { data, info, name: file.name };
                dom.btnFwFlash.disabled = false;
                setFirmwareStepState(dom.fwStepFile, 'complete');
                setFirmwareStepState(dom.fwStepFlash, 'active');
                dom.fwStepFlash.classList.remove('fw-step-hidden');
                log(`UF2 loaded: ${file.name} (${summary})`, 'success');
            } catch (err) {
                log(`Invalid UF2 file: ${err.message}`, 'error');
                selectedUF2 = null;
            }
        };
        reader.onerror = () => log('Failed to read file', 'error');
        reader.readAsArrayBuffer(file);
    }

    // ====================================================
    // Firmware List
    // ====================================================

    async function loadFirmwareList() {
        if (!dom.fwReleaseLoading) return;
        dom.fwReleaseLoading.style.display = '';
        dom.fwReleaseError.style.display = 'none';
        dom.fwReleaseContent.style.display = 'none';

        try {
            const manifest = await PicoCTRFirmwareReleases.loadManifest();
            const { version, date, assets } = PicoCTRFirmwareReleases.buildAssetList(manifest);
            latestRelease = { version, date, assets };

            if (assets.length === 0) throw new Error('No firmware files available');

            dom.fwReleaseTag.textContent = version ? `v${version}` : '';
            if (date) dom.fwReleaseDate.textContent = new Date(date).toLocaleDateString();

            dom.fwReleaseList.innerHTML = '';
            const grouped = new Map();
            for (const asset of assets) {
                if (!grouped.has(asset.manufacturer)) grouped.set(asset.manufacturer, []);
                grouped.get(asset.manufacturer).push(asset);
            }
            for (const entries of grouped.values()) {
                entries.sort((a, b) => {
                    if (a.isDev !== b.isDev) return a.isDev ? 1 : -1;
                    return a.displayName.localeCompare(b.displayName);
                });
            }
            for (const [manufacturer, entries] of grouped) {
                const sep = document.createElement('div');
                sep.className = 'fw-release-category';
                sep.textContent = manufacturer;
                dom.fwReleaseList.appendChild(sep);

                for (const asset of entries) {
                    const item = document.createElement('button');
                    item.className = 'fw-release-item' + (asset.isDev ? ' fw-release-item-dev' : '');
                    item.innerHTML = `
                        <div class="fw-release-item-info">
                            <span class="fw-release-item-name">${asset.displayName}${asset.isDev ? ' <span class="fw-dev-badge">DEV</span>' : ''}</span>
                            ${asset.description ? `<span class="fw-release-item-desc">${asset.description}</span>` : ''}
                        </div>
                    `;
                    item.addEventListener('click', () => handleFirmwareSelect(asset, item));
                    dom.fwReleaseList.appendChild(item);
                }
            }

            dom.fwReleaseLoading.style.display = 'none';
            dom.fwReleaseContent.style.display = '';
            log(`${assets.length} firmware files available (v${version})`, 'success');
        } catch (err) {
            dom.fwReleaseLoading.style.display = 'none';
            dom.fwReleaseErrorMsg.textContent = err.message;
            dom.fwReleaseError.style.display = '';
            log(`Failed to load firmware list: ${err.message}`, 'error');
        }
    }

    async function handleFirmwareSelect(asset, itemEl) {
        dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => {
            el.classList.remove('selected');
            el.disabled = false;
        });
        itemEl.classList.add('selected');

        selectedUF2 = null;
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwFlash.disabled = true;

        itemEl.classList.add('downloading');
        log(`Downloading ${asset.displayName}...`);

        try {
            const data = await PicoCTRFirmwareReleases.downloadFirmware(asset.url);
            itemEl.classList.remove('downloading');

            const info = PicobootConnection.getUF2Info(data);
            const summary = displayUF2Info(info, asset.name);
            if (!summary) {
                selectedUF2 = null;
                return;
            }

            selectedUF2 = { data, info, name: asset.name };
            dom.btnFwFlash.disabled = false;
            setFirmwareStepState(dom.fwStepFile, 'complete');
            setFirmwareStepState(dom.fwStepFlash, 'active');
            dom.fwStepFlash.classList.remove('fw-step-hidden');
            log(`Firmware ready: ${asset.displayName} (${summary})`, 'success');
        } catch (err) {
            itemEl.classList.remove('downloading');
            log(`Failed to download ${asset.displayName}: ${err.message}`, 'error');
        }
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    async function handleFwFlash() {
        if (!picoboot || !selectedUF2 || isFlashing) return;
        if (!confirm(`Flash firmware "${selectedUF2.name}"?\n\nThis will erase and reprogram the device flash. Do not disconnect the device during this process.`)) {
            return;
        }

        isFlashing = true;
        dom.btnFwFlash.disabled = true;
        dom.btnFwConnect.disabled = true;
        dom.btnFwBrowse.disabled = true;
        if (dom.fwReleaseList) dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => el.disabled = true);
        dom.fwProgressContainer.style.display = '';
        dom.fwProgressFill.className = 'fw-progress-fill';
        log(`Flashing ${selectedUF2.name}...`);

        try {
            await picoboot.flashUF2(selectedUF2.data, (phase, current, total, message) => {
                let pct = 0;
                switch (phase) {
                    case 'parse': pct = 2; break;
                    case 'erase': pct = 2 + (current / Math.max(total, 1)) * 28; break;
                    case 'write': pct = 30 + (current / Math.max(total, 1)) * 65; break;
                    case 'reboot': pct = 95; break;
                    case 'done': pct = 100; break;
                    case 'error': pct = 100; break;
                }

                dom.fwProgressFill.style.width = `${Math.round(pct)}%`;
                dom.fwProgressText.textContent = message;

                if (phase === 'done') {
                    dom.fwProgressFill.classList.add('complete');
                    log('Firmware flashed successfully! Device is rebooting.', 'success');
                    setFirmwareStepState(dom.fwStepFlash, 'complete');
                    setTimeout(() => {
                        hideFirmwareSection();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        log('Device rebooted. Click "Connect PicoCTR" to connect and configure settings.', 'info');
                    }, 2500);
                } else if (phase === 'error') {
                    dom.fwProgressFill.classList.add('error');
                    log(`Flash error: ${message}`, 'error');
                } else if (phase === 'erase' || phase === 'write') {
                    if (current === 0) log(message, 'info');
                }
            });
        } catch (err) {
            log(`Flash failed: ${err.message}`, 'error');
            dom.fwProgressFill.classList.add('error');
            dom.fwProgressText.textContent = `Failed: ${err.message}`;
        } finally {
            isFlashing = false;
            dom.btnFwConnect.disabled = false;
        }
    }

    // ========================================================================
    // Event Handlers for Settings UI
    // ========================================================================
    function setupSettingsListeners() {
        if (colorPicker) {
            colorPicker.on('input:change', (color) => {
                const { r, g, b } = color.rgb;
                dom.colorR.value = r;
                dom.colorG.value = g;
                dom.colorB.value = b;
                dom.colorHexDisplay.textContent = color.hexString;
                checkUnsavedChanges();

                if (!liveColorTimer && picoctr && picoctr.connected) {
                    liveColorTimer = setTimeout(async () => {
                        liveColorTimer = null;
                        try {
                            await picoctr.setSettings(getSettingsFromUI());
                        } catch (e) { /* ignore live drag errors */ }
                    }, LIVE_COLOR_INTERVAL);
                }
            });

            colorPicker.on('input:end', async () => {
                if (liveColorTimer) {
                    clearTimeout(liveColorTimer);
                    liveColorTimer = null;
                }
                if (picoctr && picoctr.connected) {
                    try {
                        await picoctr.setSettings(getSettingsFromUI());
                    } catch (e) { /* ignore */ }
                }
            });
        }

        [dom.colorR, dom.colorG, dom.colorB].forEach(input => {
            input.addEventListener('input', () => {
                const r = Math.min(255, Math.max(0, parseInt(dom.colorR.value) || 0));
                const g = Math.min(255, Math.max(0, parseInt(dom.colorG.value) || 0));
                const b = Math.min(255, Math.max(0, parseInt(dom.colorB.value) || 0));
                if (colorPicker) colorPicker.color.rgb = { r, g, b };
                dom.colorHexDisplay.textContent = rgbToHex(r, g, b);
                checkUnsavedChanges();
            });
        });

        dom.brightness.addEventListener('input', () => {
            dom.brightnessValue.textContent = dom.brightness.value;
            checkUnsavedChanges();
        });

        dom.animation.addEventListener('change', () => {
            updateColorGroupVisibility();
            checkUnsavedChanges();
        });

        [dom.enableRgb, dom.ledCount].forEach(el => {
            el.addEventListener('change', () => checkUnsavedChanges());
            el.addEventListener('input', () => checkUnsavedChanges());
        });
    }

    // ========================================================================
    // Initialization
    // ========================================================================
    async function init() {
        // Check WebUSB support (replaces WebHID check)
        if (!PicoCTRDevice.isSupported()) {
            dom.browserWarning.style.display = '';
            dom.btnConnect.disabled = true;
            log('WebUSB is not supported in this browser', 'error');
            return;
        }

        const configLoaded = await loadConfig();
        if (!configLoaded) {
            dom.btnConnect.disabled = true;
            return;
        }

        picoctr = new PicoCTRDevice(config);

        populateAnimationSelect();
        updateColorGroupVisibility();

        colorPicker = new iro.ColorPicker('#iro-picker', {
            width: 220,
            color: '#ff0000',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            wheelLightness: false,
            layout: [
                { component: iro.ui.Wheel },
                { component: iro.ui.Slider, options: { sliderType: 'value' } }
            ]
        });

        setupSettingsListeners();

        // Button handlers
        dom.btnConnect.addEventListener('click', handleConnect);
        dom.btnDisconnect.addEventListener('click', handleDisconnect);
        dom.btnApply.addEventListener('click', showApplyDialog);
        dom.applyDialogCancel.addEventListener('click', () => dom.applyDialog.close());
        dom.applyDialogConfirm.addEventListener('click', () => {
            dom.applyDialog.close();
            applySettings();
        });
        dom.applyDialogSave.addEventListener('click', () => {
            dom.applyDialog.close();
            saveSettings();
        });
        dom.btnRead.addEventListener('click', async () => {
            await readSettings();
            await readPinMappings();
        });
        dom.btnReset.addEventListener('click', resetSettings);
        dom.btnUndo.addEventListener('click', undoChanges);
        dom.btnBootsel.addEventListener('click', enterBootsel);
        dom.btnClearLog.addEventListener('click', () => {
            dom.logOutput.innerHTML = '';
            log('Log cleared');
        });

        // Mapping import/export handlers
        dom.btnMappingExport.addEventListener('click', exportMapping);
        dom.btnMappingImport.addEventListener('click', () => dom.mappingFileInput.click());
        dom.mappingFileInput.addEventListener('change', handleMappingImport);

        // Firmware update handlers
        dom.btnFwConnect.addEventListener('click', handleFwConnect);
        dom.btnFwBrowse.addEventListener('click', () => dom.fwFileInput.click());
        dom.fwFileInput.addEventListener('change', handleFwFileSelect);
        dom.btnFwFlash.addEventListener('click', handleFwFlash);
        dom.btnBootstrap.addEventListener('click', handleBootstrap);
        dom.btnFwReturn.addEventListener('click', returnToConfigMode);

        setConnected(false);
        log('WebUSB supported. Ready to connect.');

        if (PicobootConnection.isSupported()) {
            log('Firmware flashing available via WebUSB.');
            if (navigator.userAgent.includes('Windows')) {
                const winHelp = document.getElementById('fw-windows-help');
                if (winHelp) winHelp.style.display = '';
            }
        } else {
            log('WebUSB not supported. Firmware flashing will not be available.', 'warning');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
