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
    let latestRelease = null; // cached GitHub release data
    let fwSource = 'github';  // 'github' or 'local'

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
        colorPicker: $('#setting-color-picker'),
        colorR: $('#setting-rgb_color_r'),
        colorG: $('#setting-rgb_color_g'),
        colorB: $('#setting-rgb_color_b'),
        ledCount: $('#setting-led_count'),
        brightness: $('#setting-led_brightness'),
        brightnessValue: $('#brightness-value'),
        // Action buttons
        btnApply: $('#btn-apply'),
        btnSave: $('#btn-save'),
        btnRead: $('#btn-read'),
        btnReset: $('#btn-reset'),
        btnBootsel: $('#btn-bootsel'),
        btnClearLog: $('#btn-clear-log'),
        btnBootstrap: $('#btn-bootstrap'),
        // Apply confirmation dialog
        applyDialog: $('#apply-dialog'),
        applyDialogCancel: $('#apply-dialog-cancel'),
        applyDialogConfirm: $('#apply-dialog-confirm'),
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
        fwInfoTarget: $('#fw-info-target'),
        fwInfoBlocks: $('#fw-info-blocks'),
        fwInfoSize: $('#fw-info-size'),
        fwInfoAddr: $('#fw-info-addr'),
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
        // Firmware source tabs
        fwTabGithub: $('#fw-tab-github'),
        fwTabLocal: $('#fw-tab-local'),
        fwPanelGithub: $('#fw-panel-github'),
        fwPanelLocal: $('#fw-panel-local'),
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
        [dom.btnApply, dom.btnSave, dom.btnRead, dom.btnReset, dom.btnBootsel].forEach(btn => {
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
        dom.colorPicker.value = rgbToHex(r, g, b);

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

    function checkUnsavedChanges() {
        if (!currentSettings || !flashSettings) {
            dom.unsavedBanner.style.display = 'none';
            return;
        }
        const uiSettings = getSettingsFromUI();
        const hasChanges = JSON.stringify(uiSettings) !== JSON.stringify(flashSettings);
        dom.unsavedBanner.style.display = hasChanges ? '' : 'none';
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
        if (!confirm('Update firmware?\n\nThe device will disconnect and reboot into firmware update mode.\nYou can then flash a new .uf2 firmware via the Firmware Update section below.')) {
            return;
        }
        try {
            log('Entering BOOTSEL mode...');
            await picoctr.enterBootsel();
            log('Device entered BOOTSEL mode. Use the Firmware Update section below to flash new firmware.', 'warning');
            showFirmwareSection();
        } catch (err) {
            // Device disconnects immediately, so errors are expected
            log('Device entered BOOTSEL mode. Use the Firmware Update section below to flash new firmware.', 'warning');
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
     * Bootstrap mode: for brand-new devices already in BOOTSEL mode.
     * Shows the firmware section and immediately opens the WebUSB device picker.
     */
    async function handleBootstrap() {
        log('Bootstrap mode: looking for device in BOOTSEL mode...', 'info');
        showFirmwareSection();
        // Immediately trigger the BOOTSEL device connection
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
        dom.fwFileName.textContent = 'No file selected';
        dom.fwFileName.classList.remove('fw-file-hint');
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwBrowse.disabled = true;
        selectedUF2 = null;

        // Reset source tabs
        dom.fwTabGithub.disabled = true;
        dom.fwTabLocal.disabled = true;
        switchFwSource('github');

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
        fwSource = source;
        dom.fwTabGithub.classList.toggle('active', source === 'github');
        dom.fwTabLocal.classList.toggle('active', source === 'local');
        dom.fwPanelGithub.style.display = source === 'github' ? '' : 'none';
        dom.fwPanelLocal.style.display = source === 'local' ? '' : 'none';
        // Clear selection when switching
        dom.fwFileInfo.style.display = 'none';
        dom.fwValidationWarning.style.display = 'none';
        dom.btnFwFlash.disabled = true;
        selectedUF2 = null;
        setFirmwareStepState(dom.fwStepFlash, '');
    }

    function setFirmwareStepState(stepEl, state) {
        stepEl.classList.remove('step-active', 'step-complete');
        if (state === 'active') stepEl.classList.add('step-active');
        if (state === 'complete') stepEl.classList.add('step-complete');
    }

    async function handleFwConnect() {
        if (!PicobootConnection.isSupported()) {
            log('WebUSB is not supported in this browser', 'error');
            return;
        }

        try {
            log('Requesting BOOTSEL device connection via WebUSB...');
            picoboot = new PicobootConnection();

            const device = await picoboot.connect();
            const name = device.productName || 'RP2040 BOOTSEL';
            dom.fwDeviceInfo.style.display = '';
            dom.fwDeviceName.textContent = name;
            dom.btnFwBrowse.disabled = false;

            // Enable source tabs
            dom.fwTabGithub.disabled = false;
            dom.fwTabLocal.disabled = false;

            setFirmwareStepState(dom.fwStepConnect, 'complete');
            setFirmwareStepState(dom.fwStepFile, 'active');

            log(`BOOTSEL device connected: ${name}`, 'success');

            // Start loading GitHub releases in background
            loadGitHubReleases();

            // Handle disconnection
            picoboot.onDisconnect(() => {
                log('BOOTSEL device disconnected', 'warning');
                if (!isFlashing) {
                    resetFirmwareUI();
                }
            });
        } catch (err) {
            if (err.name === 'NotFoundError' || err.message?.includes('No device selected')) {
                log('BOOTSEL device selection cancelled', 'warning');
            } else {
                log(`BOOTSEL connection failed: ${err.message}`, 'error');
            }
            picoboot = null;
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
        dom.fwInfoTarget.textContent = info.familyId;
        dom.fwInfoBlocks.textContent = info.blocks.toString();
        dom.fwInfoSize.textContent = formatBytes(info.totalSize);
        dom.fwInfoAddr.textContent = `${info.minAddr} – ${info.maxAddr}`;
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
        parts.push(`${info.blocks} blocks`);
        parts.push(formatBytes(info.totalSize));
        parts.push(info.familyId);
        return parts.join(', ');
    }

    function handleFwFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        dom.fwFileName.textContent = file.name;
        dom.fwFileName.classList.remove('fw-file-hint');
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

    async function loadGitHubReleases() {
        dom.fwReleaseLoading.style.display = '';
        dom.fwReleaseError.style.display = 'none';
        dom.fwReleaseContent.style.display = 'none';

        try {
            // Load manifest from the local site (same origin — no CORS issues)
            const manifest = await PicoCTRFirmwareReleases.loadLocalManifest();

            // Fetch release metadata from GitHub API (JSON endpoint has CORS)
            latestRelease = await PicoCTRFirmwareReleases.fetchLatestRelease(manifest);

            if (latestRelease.assets.length === 0) {
                throw new Error('No firmware files found in the latest release');
            }

            // Populate release header
            dom.fwReleaseTag.textContent = latestRelease.tag;
            dom.fwReleaseDate.textContent = new Date(latestRelease.publishedAt).toLocaleDateString();
            dom.fwReleaseLink.href = latestRelease.htmlUrl;

            // Build firmware list, grouped by category
            dom.fwReleaseList.innerHTML = '';

            // Sort: consumer first, then standard, then development; non-legacy before legacy
            const categoryOrder = { consumer: 0, standard: 1, development: 2 };
            const sorted = [...latestRelease.assets].sort((a, b) => {
                const catA = categoryOrder[a.category] ?? 9;
                const catB = categoryOrder[b.category] ?? 9;
                if (catA !== catB) return catA - catB;
                if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
                return a.displayName.localeCompare(b.displayName);
            });

            let lastCategory = null;
            for (const asset of sorted) {
                // Add category separator
                if (asset.category !== lastCategory) {
                    lastCategory = asset.category;
                    const label = { consumer: 'AtGames Consoles', standard: 'Standard', development: 'Development' }[asset.category] || asset.category;
                    const sep = document.createElement('div');
                    sep.className = 'fw-release-category';
                    sep.textContent = label;
                    dom.fwReleaseList.appendChild(sep);
                }

                const item = document.createElement('button');
                item.className = 'fw-release-item' + (asset.isLegacy ? ' fw-release-item-legacy' : '');
                item.innerHTML = `
                    <div class="fw-release-item-info">
                        <span class="fw-release-item-name">${asset.displayName}</span>
                        ${asset.description ? `<span class="fw-release-item-desc">${asset.description}</span>` : ''}
                    </div>
                    <span class="fw-release-item-meta">${formatBytes(asset.size)}</span>
                `;
                item.addEventListener('click', () => handleGitHubAssetSelect(asset, item));
                dom.fwReleaseList.appendChild(item);
            }

            dom.fwReleaseLoading.style.display = 'none';
            dom.fwReleaseContent.style.display = '';

            const src = latestRelease.hasManifest ? 'manifest' : 'fallback map';
            log(`Loaded ${latestRelease.assets.length} firmware files from release ${latestRelease.tag} (${src})`, 'success');
        } catch (err) {
            dom.fwReleaseLoading.style.display = 'none';
            dom.fwReleaseErrorMsg.textContent = err.message;
            dom.fwReleaseError.style.display = '';
            log(`Failed to load GitHub releases: ${err.message}`, 'error');
        }
    }

    async function handleGitHubAssetSelect(asset, itemEl) {
        // Deselect all items
        dom.fwReleaseList.querySelectorAll('.fw-release-item').forEach(el => el.classList.remove('selected'));
        itemEl.classList.add('selected');

        // Trigger native browser download (bypasses CORS — uses <a> navigation)
        log(`Downloading ${asset.displayName} (${asset.name})...`);
        PicoCTRFirmwareReleases.triggerNativeDownload(asset.browserUrl, asset.name);

        // Switch to Local File tab so user can select the downloaded file
        switchFwSource('local');
        dom.btnFwBrowse.disabled = false;
        dom.fwFileName.textContent = `⬇️ Downloading ${asset.name} — select it from your Downloads folder`;
        dom.fwFileName.classList.add('fw-file-hint');

        log(`"${asset.name}" download started. Select the downloaded file using the file picker to continue.`, 'info');
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
        dom.fwTabGithub.disabled = true;
        dom.fwTabLocal.disabled = true;
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
        // Color picker ↔ RGB inputs sync
        dom.colorPicker.addEventListener('input', () => {
            const { r, g, b } = hexToRgb(dom.colorPicker.value);
            dom.colorR.value = r;
            dom.colorG.value = g;
            dom.colorB.value = b;
            checkUnsavedChanges();
        });

        [dom.colorR, dom.colorG, dom.colorB].forEach(input => {
            input.addEventListener('input', () => {
                const r = parseInt(dom.colorR.value) || 0;
                const g = parseInt(dom.colorG.value) || 0;
                const b = parseInt(dom.colorB.value) || 0;
                dom.colorPicker.value = rgbToHex(
                    Math.min(255, Math.max(0, r)),
                    Math.min(255, Math.max(0, g)),
                    Math.min(255, Math.max(0, b))
                );
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
        dom.btnSave.addEventListener('click', saveSettings);
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

        // Firmware source tab handlers
        dom.fwTabGithub.addEventListener('click', () => switchFwSource('github'));
        dom.fwTabLocal.addEventListener('click', () => switchFwSource('local'));

        // Set initial state
        setConnected(false);

        log('WebHID supported. Ready to connect.');

        // Check WebUSB for firmware update
        if (PicobootConnection.isSupported()) {
            log('WebUSB supported. Firmware flashing available.');
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
