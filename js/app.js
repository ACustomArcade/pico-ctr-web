/**
 * PicoCTR Web Configurator - Application Logic
 *
 * Handles UI interactions, config loading, and coordinates with the WebHID layer.
 */

(function () {
    'use strict';

    // ========================================================================
    // State
    // ========================================================================
    let config = null;
    let picoctr = null;
    let currentSettings = null;
    let flashSettings = null;

    // Firmware update state
    let picoboot = null;
    let selectedUF2 = null;  // { data: ArrayBuffer, info: object, name: string }
    let isFlashing = false;
    let latestRelease = null; // cached firmware manifest data

    // Color picker state
    let colorPicker = null;       // iro.js ColorPicker instance
    let liveColorTimer = null;    // throttle timer for live device updates
    const LIVE_COLOR_INTERVAL = 80; // ms between live device sends

    // ========================================================================
    // DOM References
    // ========================================================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        browserWarning: $('#browser-warning'),
        btnConnect: $('#btn-connect'),
        btnDisconnect: $('#btn-disconnect'),
        statusDot: $('.status-dot'),
        statusText: $('.status-text'),
        deviceInfoSection: $('#device-info-section'),
        settingsSection: $('#settings-section'),
        actionsSection: $('#actions-section'),
        unsavedBanner: $('#unsaved-banner'),
        logOutput: $('#log-output'),
        // Device info
        infoBoard: $('#info-board'),
        infoVersion: $('#info-version'),
        infoBuildType: $('#info-build-type'),
        infoUsbId: $('#info-usb-id'),
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
        // Action buttons
        btnApply: $('#btn-apply'),
        btnRead: $('#btn-read'),
        btnReset: $('#btn-reset'),
        btnBootsel: $('#btn-bootsel'),
        btnClearLog: $('#btn-clear-log'),
        btnBootstrap: $('#btn-bootstrap'),
        // Apply confirmation dialog
        applyDialog: $('#apply-dialog'),
        applyDialogCancel: $('#apply-dialog-cancel'),
        applyDialogConfirm: $('#apply-dialog-confirm'),
        applyDialogSave: $('#apply-dialog-save'),
        // Color group (for show/hide based on animation)
        colorGroup: $('#color-group'),
        // Firmware update
        firmwareSection: $('#firmware-section'),
        btnFwConnect: $('#btn-fw-connect'),
        fwDeviceInfo: $('#fw-device-info'),
        fwDeviceName: $('#fw-device-name'),
        fwFileInput: $('#fw-file-input'),
        btnFwBrowse: $('#btn-fw-browse'),
        fwFileName: $('#fw-file-name'),
        fwFileInfo: $('#fw-file-info'),
        fwInfoSize: $('#fw-info-size'),
        fwInfoBoard: $('#fw-info-board'),
        fwInfoVersion: $('#fw-info-version'),
        fwInfoGit: $('#fw-info-git'),
        fwInfoRowBoard: $('#fw-info-row-board'),
        fwInfoRowVersion: $('#fw-info-row-version'),
        fwInfoRowGit: $('#fw-info-row-git'),
        fwValidationWarning: $('#fw-validation-warning'),
        btnFwFlash: $('#btn-fw-flash'),
        fwProgressContainer: $('#fw-progress-container'),
        fwProgressFill: $('#fw-progress-fill'),
        fwProgressText: $('#fw-progress-text'),
        fwStepConnect: $('#fw-step-connect'),
        fwStepFile: $('#fw-step-file'),
        fwStepFlash: $('#fw-step-flash'),
        fwConnectStatus: $('#fw-connect-status'),
        // Firmware release list
        fwReleaseLoading: $('#fw-release-loading'),
        fwReleaseError: $('#fw-release-error'),
        fwReleaseErrorMsg: $('#fw-release-error-msg'),
        fwReleaseFallbackLink: $('#fw-release-fallback-link'),
        fwReleaseContent: $('#fw-release-content'),
        fwReleaseTag: $('#fw-release-tag'),
        fwReleaseDate: $('#fw-release-date'),
        fwReleaseLink: $('#fw-release-link'),
        fwReleaseList: $('#fw-release-list'),
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
        dom.actionsSection.style.display = isConnected ? '' : 'none';

        // Disable action buttons when not connected
        [dom.btnApply, dom.btnRead, dom.btnReset, dom.btnBootsel].forEach(btn => {
            btn.disabled = !isConnected;
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

        // RGB enable
        dom.enableRgb.checked = !!settings.enable_rgb;

        // Animation
        dom.animation.value = settings.rgb_animation || 0;

        // Color
        const r = settings.rgb_color_r || 0;
        const g = settings.rgb_color_g || 0;
        const b = settings.rgb_color_b || 0;
        dom.colorR.value = r;
        dom.colorG.value = g;
        dom.colorB.value = b;
        dom.colorHexDisplay.textContent = rgbToHex(r, g, b);
        // Update iro.js picker without triggering input:change
        if (colorPicker) {
            colorPicker.color.rgb = { r, g, b };
        }

        // LED Count
        dom.ledCount.value = settings.led_count || 64;

        // Brightness
        dom.brightness.value = settings.led_brightness || 0;
        dom.brightnessValue.textContent = settings.led_brightness || 0;
    }

    function getSettingsFromUI() {
        return {
            enable_rgb: dom.enableRgb.checked ? 1 : 0,
            rgb_animation: parseInt(dom.animation.value) || 0,
            rgb_color_r: parseInt(dom.colorR.value) || 0,
            rgb_color_g: parseInt(dom.colorG.value) || 0,
            rgb_color_b: parseInt(dom.colorB.value) || 0,
            led_count: parseInt(dom.ledCount.value) || 64,
            led_brightness: parseInt(dom.brightness.value) || 0,
        };
    }

    /**
     * Map from settings field name → the DOM element(s) whose
     * closest .form-group should be highlighted when changed.
     */
    const fieldDomMap = {
        enable_rgb:    () => [dom.enableRgb],
        rgb_animation: () => [dom.animation],
        rgb_color_r:   () => [dom.colorR, dom.colorG, dom.colorB],
        rgb_color_g:   () => [dom.colorR, dom.colorG, dom.colorB],
        rgb_color_b:   () => [dom.colorR, dom.colorG, dom.colorB],
        led_count:     () => [dom.ledCount],
        led_brightness:() => [dom.brightness],
    };

    function checkUnsavedChanges() {
        // Clear all existing highlights first
        document.querySelectorAll('.field-modified').forEach(el =>
            el.classList.remove('field-modified')
        );

        if (!flashSettings) {
            dom.unsavedBanner.style.display = 'none';
            return;
        }

        const uiSettings = getSettingsFromUI();
        const changedFields = [];

        for (const key of Object.keys(flashSettings)) {
            if (uiSettings[key] !== flashSettings[key]) {
                changedFields.push(key);
                // Highlight the form-group(s) for this field
                const elements = fieldDomMap[key]?.() || [];
                const groups = new Set();
                for (const el of elements) {
                    const group = el.closest('.form-group');
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

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }

    /** Show color picker only when Solid Color animation is selected (id=0) */
    function updateColorGroupVisibility() {
        const isSolid = parseInt(dom.animation.value) === 0;
        dom.colorGroup.style.display = isSolid ? '' : 'none';
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

            // Show USB ID
            const vid = info.vendorId.toString(16).padStart(4, '0').toUpperCase();
            const pid = info.productId.toString(16).padStart(4, '0').toUpperCase();
            dom.infoUsbId.textContent = `${vid}:${pid}`;

            // Handle disconnect
            picoctr.onDisconnect(() => {
                log('Device disconnected', 'warning');
                setConnected(false);
                currentSettings = null;
                flashSettings = null;
                document.querySelectorAll('.field-modified').forEach(el =>
                    el.classList.remove('field-modified')
                );
                dom.unsavedBanner.style.display = 'none';
            });

            // Read device info and settings
            await readDeviceInfo();
            await readSettings();
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
            // Clear unsaved highlights
            document.querySelectorAll('.field-modified').forEach(el =>
                el.classList.remove('field-modified')
            );
            dom.unsavedBanner.style.display = 'none';
        } catch (err) {
            log(`Disconnect error: ${err.message}`, 'error');
        }
    }

    // ========================================================================
    // Device Info
    // ========================================================================
    async function readDeviceInfo() {
        try {
            const info = await picoctr.getDeviceInfo();
            dom.infoBoard.textContent = info.board || '—';
            dom.infoVersion.textContent = info.versionFull || info.version || '—';
            dom.infoBuildType.textContent = info.buildType || '—';

            log(`Board: ${info.board}, FW: ${info.version} (${info.buildType})`, 'info');
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
                picoctr.getFlashSettings()
            ]);

            // Normalize bool to int for comparison
            const normalizeSettings = (s) => ({
                ...s,
                enable_rgb: s.enable_rgb ? 1 : 0
            });

            currentSettings = normalizeSettings(settings);
            flashSettings = normalizeSettings(flash);

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

    function showApplyDialog() {
        dom.applyDialog.showModal();
    }

    async function applySettings() {
        try {
            const settings = getSettingsFromUI();
            log('Applying settings to device...');
            await picoctr.setSettings(settings);
            currentSettings = { ...settings };
            checkUnsavedChanges();
            log('Settings applied (not saved to flash)', 'success');
        } catch (err) {
            log(`Failed to apply settings: ${err.message}`, 'error');
        }
    }

    async function saveSettings() {
        try {
            // Apply first, then save
            const settings = getSettingsFromUI();
            await picoctr.setSettings(settings);
            log('Saving settings to flash...');
            await picoctr.save();

            // Wait a moment for flash write to complete, then re-read
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
            log('Settings reset to defaults', 'success');
        } catch (err) {
            log(`Failed to reset settings: ${err.message}`, 'error');
        }
    }

    async function enterBootsel() {
        if (!confirm('Update firmware?\n\nThe device will disconnect and reboot into flash mode.\nYou can then flash a new firmware via the Firmware Update section below.')) {
            return;
        }
        try {
            log('Entering flash mode...');
            await picoctr.enterBootsel();
            log('Device entered flash mode. Use the Firmware Update section below to flash new firmware.', 'warning');
            showFirmwareSection();
        } catch (err) {
            // Device disconnects immediately, so errors are expected
            log('Device entered flash mode. Use the Firmware Update section below to flash new firmware.', 'warning');
            showFirmwareSection();
        }
    }

    // ========================================================================
    // Firmware Update
    // ========================================================================

    function showFirmwareSection() {
        dom.firmwareSection.style.display = '';
        resetFirmwareUI();
    }

    /**
     * Bootstrap mode: for brand-new devices already in flash mode.
     * Shows the firmware section and immediately opens the WebUSB device picker.
     */
    async function handleBootstrap() {
        log('Bootstrap mode: looking for device in flash mode...', 'info');
        showFirmwareSection();
        // Immediately trigger the device connection
        await handleFwConnect();
    }

    function hideFirmwareSection() {
        dom.firmwareSection.style.display = 'none';
        resetFirmwareUI();
    }

    function resetFirmwareUI() {
        // Reset connection step
        dom.fwDeviceInfo.style.display = 'none';
        dom.fwDeviceName.textContent = '—';

        // Reset file step
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwBrowse.disabled = true;
        selectedUF2 = null;

        // Reset release panel
        dom.fwReleaseLoading.style.display = '';
        dom.fwReleaseError.style.display = 'none';
        dom.fwReleaseContent.style.display = 'none';
        dom.fwReleaseList.innerHTML = '';

        // Reset flash step
        dom.btnFwFlash.disabled = true;
        dom.fwProgressContainer.style.display = 'none';
        dom.fwProgressFill.style.width = '0%';
        dom.fwProgressFill.className = 'fw-progress-fill';
        dom.fwProgressText.textContent = 'Waiting...';

        // Reset step states
        setFirmwareStepState(dom.fwStepConnect, 'active');
        setFirmwareStepState(dom.fwStepFile, '');
        setFirmwareStepState(dom.fwStepFlash, '');

        // Disconnect picoboot if connected
        if (picoboot) {
            picoboot.disconnect().catch(() => {});
            picoboot = null;
        }
    }

    function switchFwSource(source) {
        // No-op — kept for compatibility but tabs have been removed.
        // The firmware list and local file input are always visible.
    }

    function setFirmwareStepState(stepEl, state) {
        stepEl.classList.remove('step-active', 'step-complete');
        if (state === 'active') stepEl.classList.add('step-active');
        if (state === 'complete') stepEl.classList.add('step-complete');
    }

    /**
     * Detect if a WebUSB error is likely a Windows driver issue.
     * On Windows, claimInterface() fails with SecurityError or NetworkError
     * when the interface doesn't have the WinUSB driver.
     */
    function _isWindowsDriverError(err) {
        const isWindows = navigator.userAgent.includes('Windows');
        const isDriverError = err.name === 'SecurityError' ||
            err.name === 'NetworkError' ||
            err.message?.includes('Unable to claim interface') ||
            err.message?.includes('Access denied') ||
            err.message?.includes('failed to claim');
        return isWindows && isDriverError;
    }

    /**
     * Show an inline status message under the Connect button.
     * @param {string} message - The message to show (empty to hide)
     * @param {'info'|'error'|'success'|''} type - Message type for styling
     */
    function _setConnectStatus(message, type = '') {
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
            _setConnectStatus('');  // clear status on success

            setFirmwareStepState(dom.fwStepConnect, 'complete');
            setFirmwareStepState(dom.fwStepFile, 'active');

            // Reveal step 2
            dom.fwStepFile.classList.remove('fw-step-hidden');

            log(`Device connected: ${name}`, 'success');

            // Start loading firmware list in background
            loadFirmwareList();

            // Handle disconnection
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

    /**
     * Display UF2 info (binary info + technical details) in the firmware info panel.
     * Shared by both local file and GitHub download flows.
     */
    function displayUF2Info(info, name) {
        // Binary info rows
        if (info.board) {
            dom.fwInfoBoard.textContent = info.board;
            dom.fwInfoRowBoard.style.display = '';
        } else {
            dom.fwInfoRowBoard.style.display = 'none';
        }
        if (info.version) {
            dom.fwInfoVersion.textContent = info.version;
            dom.fwInfoRowVersion.style.display = '';
        } else {
            dom.fwInfoRowVersion.style.display = 'none';
        }
        if (info.git) {
            dom.fwInfoGit.textContent = info.git;
            dom.fwInfoRowGit.style.display = '';
        } else {
            dom.fwInfoRowGit.style.display = 'none';
        }

        // Technical info
        dom.fwInfoSize.textContent = formatBytes(info.totalSize);
        dom.fwFileInfo.style.display = '';

        // Reject non-PicoCTR firmware
        if (!info.isPicoCTR) {
            dom.fwFileInfo.style.display = 'none';
            dom.fwValidationWarning.style.display = '';
            log(`Error: "${name}" does not appear to be PicoCTR firmware`, 'error');
            return null;
        }

        dom.fwValidationWarning.style.display = 'none';

        // Build summary string
        const parts = [];
        if (info.board) parts.push(info.board);
        if (info.version) parts.push(`v${info.version}`);
        parts.push(formatBytes(info.totalSize));
        return parts.join(', ');
    }

    function handleFwFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Deselect any selected release item
        dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => el.classList.remove('selected'));

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
                    // Not PicoCTR firmware — refuse to flash
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
                dom.fwFileName.textContent = `Error: ${err.message}`;
                selectedUF2 = null;
            }
        };
        reader.onerror = () => {
            log('Failed to read file', 'error');
        };
        reader.readAsArrayBuffer(file);
    }

    // ====================================================
    // GitHub Releases
    // ====================================================

    async function loadFirmwareList() {
        dom.fwReleaseLoading.style.display = '';
        dom.fwReleaseError.style.display = 'none';
        dom.fwReleaseContent.style.display = 'none';

        try {
            // Load manifest from same-origin /firmware/manifest.json
            const manifest = await PicoCTRFirmwareReleases.loadManifest();
            const { release, assets } = PicoCTRFirmwareReleases.buildAssetList(manifest);

            latestRelease = { release, assets };

            if (assets.length === 0) {
                throw new Error('No firmware files available');
            }

            // Populate release header
            dom.fwReleaseTag.textContent = release.tag;
            if (release.date) {
                dom.fwReleaseDate.textContent = new Date(release.date).toLocaleDateString();
            }
            if (release.url) {
                dom.fwReleaseLink.href = release.url;
                dom.fwReleaseLink.style.display = '';
            } else {
                dom.fwReleaseLink.style.display = 'none';
            }

            // Build firmware list, grouped by manufacturer
            dom.fwReleaseList.innerHTML = '';

            // Group assets by manufacturer, preserving manifest order
            const grouped = new Map();
            for (const asset of assets) {
                if (!grouped.has(asset.manufacturer)) grouped.set(asset.manufacturer, []);
                grouped.get(asset.manufacturer).push(asset);
            }

            // Sort each manufacturer's entries: non-dev first, then alphabetical
            for (const entries of grouped.values()) {
                entries.sort((a, b) => {
                    if (a.isDev !== b.isDev) return a.isDev ? 1 : -1;
                    return a.displayName.localeCompare(b.displayName);
                });
            }

            // Render by manufacturer
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

            log(`${assets.length} firmware files available (${release.tag})`, 'success');
        } catch (err) {
            dom.fwReleaseLoading.style.display = 'none';
            dom.fwReleaseErrorMsg.textContent = err.message;
            dom.fwReleaseFallbackLink.href = PicoCTRFirmwareReleases.getReleasesPageUrl();
            dom.fwReleaseError.style.display = '';
            log(`Failed to load firmware list: ${err.message}`, 'error');
        }
    }

    /**
     * Handle firmware selection from the release list.
     * Downloads the UF2 from same-origin, parses it, and readies it for flashing.
     */
    async function handleFirmwareSelect(asset, itemEl) {
        // Deselect all items, select this one
        dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => {
            el.classList.remove('selected');
            el.disabled = false;
        });
        itemEl.classList.add('selected');

        // Reset state
        selectedUF2 = null;
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwFlash.disabled = true;

        // Show downloading state
        itemEl.classList.add('downloading');
        log(`Downloading ${asset.displayName}...`);

        try {
            const data = await PicoCTRFirmwareReleases.downloadFirmware(asset.url);
            itemEl.classList.remove('downloading');

            const info = PicobootConnection.getUF2Info(data);
            const summary = displayUF2Info(info, asset.name);
            if (!summary) {
                // Not PicoCTR firmware — refuse to flash
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
        // Disable all release items during flash
        dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => el.disabled = true);
        dom.fwProgressContainer.style.display = '';
        dom.fwProgressFill.className = 'fw-progress-fill';

        log(`Flashing ${selectedUF2.name}...`);

        try {
            await picoboot.flashUF2(selectedUF2.data, (phase, current, total, message) => {
                let pct = 0;
                switch (phase) {
                    case 'parse':
                        pct = 2;
                        break;
                    case 'erase':
                        pct = 2 + (current / Math.max(total, 1)) * 28;   // 2-30%
                        break;
                    case 'write':
                        pct = 30 + (current / Math.max(total, 1)) * 65;  // 30-95%
                        break;
                    case 'reboot':
                        pct = 95;
                        break;
                    case 'done':
                        pct = 100;
                        break;
                    case 'error':
                        pct = 100;
                        break;
                }

                dom.fwProgressFill.style.width = `${Math.round(pct)}%`;
                dom.fwProgressText.textContent = message;

                if (phase === 'done') {
                    dom.fwProgressFill.classList.add('complete');
                    log('Firmware flashed successfully! Device is rebooting.', 'success');
                    setFirmwareStepState(dom.fwStepFlash, 'complete');

                    // After a short delay, redirect back to the main connect view
                    setTimeout(() => {
                        hideFirmwareSection();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        log('Device rebooted. Click "Select Device" to connect and configure settings.', 'info');
                    }, 2500);
                } else if (phase === 'error') {
                    dom.fwProgressFill.classList.add('error');
                    log(`Flash error: ${message}`, 'error');
                } else if (phase === 'erase' || phase === 'write') {
                    // Log phase changes
                    if (current === 0) {
                        log(message, 'info');
                    }
                }
            });
        } catch (err) {
            log(`Flash failed: ${err.message}`, 'error');
            dom.fwProgressFill.classList.add('error');
            dom.fwProgressText.textContent = `Failed: ${err.message}`;
        } finally {
            isFlashing = false;
            dom.btnFwConnect.disabled = false;
            // After flash complete or fail, leave buttons disabled until re-connect
        }
    }

    // ========================================================================
    // Event Handlers for Settings UI
    // ========================================================================
    function setupSettingsListeners() {
        // iro.js color picker → RGB inputs + hex display + live device send
        if (colorPicker) {
            // input:change fires only on user interaction (drag, click), not programmatic
            colorPicker.on('input:change', (color) => {
                const { r, g, b } = color.rgb;
                dom.colorR.value = r;
                dom.colorG.value = g;
                dom.colorB.value = b;
                dom.colorHexDisplay.textContent = color.hexString;
                checkUnsavedChanges();

                // Throttled live send to device
                if (!liveColorTimer && picoctr && picoctr.connected) {
                    liveColorTimer = setTimeout(async () => {
                        liveColorTimer = null;
                        try {
                            await picoctr.setSettings(getSettingsFromUI());
                        } catch (e) {
                            // Silently ignore send errors during live drag
                        }
                    }, LIVE_COLOR_INTERVAL);
                }
            });

            // When drag ends, do one final send to ensure last color is applied
            colorPicker.on('input:end', async () => {
                if (liveColorTimer) {
                    clearTimeout(liveColorTimer);
                    liveColorTimer = null;
                }
                if (picoctr && picoctr.connected) {
                    try {
                        await picoctr.setSettings(getSettingsFromUI());
                    } catch (e) {
                        // ignore
                    }
                }
            });
        }

        // RGB number inputs → sync to iro.js picker + hex display
        [dom.colorR, dom.colorG, dom.colorB].forEach(input => {
            input.addEventListener('input', () => {
                const r = Math.min(255, Math.max(0, parseInt(dom.colorR.value) || 0));
                const g = Math.min(255, Math.max(0, parseInt(dom.colorG.value) || 0));
                const b = Math.min(255, Math.max(0, parseInt(dom.colorB.value) || 0));
                if (colorPicker) {
                    colorPicker.color.rgb = { r, g, b };
                }
                dom.colorHexDisplay.textContent = rgbToHex(r, g, b);
                checkUnsavedChanges();
            });
        });

        // Brightness slider value display
        dom.brightness.addEventListener('input', () => {
            dom.brightnessValue.textContent = dom.brightness.value;
            checkUnsavedChanges();
        });

        // Animation change → show/hide color picker
        dom.animation.addEventListener('change', () => {
            updateColorGroupVisibility();
            checkUnsavedChanges();
        });

        // All other settings changes
        [dom.enableRgb, dom.ledCount].forEach(el => {
            el.addEventListener('change', () => checkUnsavedChanges());
            el.addEventListener('input', () => checkUnsavedChanges());
        });
    }

    // ========================================================================
    // Initialization
    // ========================================================================
    async function init() {
        // Check WebHID support
        if (!PicoCTRDevice.isSupported()) {
            dom.browserWarning.style.display = '';
            dom.btnConnect.disabled = true;
            log('WebHID is not supported in this browser', 'error');
            return;
        }

        // Load config
        const configLoaded = await loadConfig();
        if (!configLoaded) {
            dom.btnConnect.disabled = true;
            return;
        }

        // Initialize device handler
        picoctr = new PicoCTRDevice(config);

        // Populate dynamic UI elements
        populateAnimationSelect();
        updateColorGroupVisibility();

        // Initialize iro.js color picker
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

        // Setup settings change listeners
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
        dom.btnRead.addEventListener('click', readSettings);
        dom.btnReset.addEventListener('click', resetSettings);
        dom.btnBootsel.addEventListener('click', enterBootsel);
        dom.btnClearLog.addEventListener('click', () => {
            dom.logOutput.innerHTML = '';
            log('Log cleared');
        });

        // Firmware update handlers
        dom.btnFwConnect.addEventListener('click', handleFwConnect);
        dom.btnFwBrowse.addEventListener('click', () => dom.fwFileInput.click());
        dom.fwFileInput.addEventListener('change', handleFwFileSelect);
        dom.btnFwFlash.addEventListener('click', handleFwFlash);
        dom.btnBootstrap.addEventListener('click', handleBootstrap);

        // Set initial state
        setConnected(false);

        log('WebHID supported. Ready to connect.');

        // Check WebUSB for firmware update
        if (PicobootConnection.isSupported()) {
            log('WebUSB supported. Firmware flashing available.');

            // Proactively show Windows driver note
            if (navigator.userAgent.includes('Windows')) {
                const winHelp = document.getElementById('fw-windows-help');
                if (winHelp) winHelp.style.display = '';
            }
        } else {
            log('WebUSB not supported. Firmware flashing will not be available.', 'warning');
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
