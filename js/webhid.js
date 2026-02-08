/**
 * PicoCTR WebHID Communication Layer
 *
 * Handles USB HID communication with PicoCTR devices via the WebHID browser API.
 * Provides methods for reading/writing settings, device info, and commands.
 *
 * Report IDs and data formats are loaded from picoctr-config.json (generated
 * by tools/generate_web_config.py from firmware annotations).
 */

class PicoCTRDevice {
    constructor(config) {
        this.config = config;
        this.device = null;
        this._onDisconnect = null;
    }

    /** Check if WebHID is available in this browser */
    static isSupported() {
        return 'hid' in navigator;
    }

    /** Get whether a device is currently connected and opened */
    get connected() {
        return this.device !== null && this.device.opened;
    }

    /**
     * Parse a hex string like "0xF1" to an integer
     */
    _hex(val) {
        if (typeof val === 'number') return val;
        return parseInt(val, 16);
    }

    /**
     * Get report ID integer from config by name
     */
    _reportId(name) {
        const report = this.config.report_ids[name];
        if (!report) throw new Error(`Unknown report: ${name}`);
        return this._hex(report.id);
    }

    /**
     * Build WebHID filters from config
     * Filters by vendor usage page (0xFF00) to target only the settings interface
     */
    _buildFilters() {
        const usagePage = this._hex(this.config.webhid.usage_page);
        const usage = this._hex(this.config.webhid.usage);

        return this.config.webhid.filters.map(f => ({
            vendorId: this._hex(f.vendorId),
            productId: this._hex(f.productId),
            usagePage: usagePage,
            usage: usage
        }));
    }

    /**
     * Request and open a PicoCTR device via WebHID
     * Shows browser device picker filtered to known PicoCTR VID/PIDs
     */
    async connect() {
        if (!PicoCTRDevice.isSupported()) {
            throw new Error('WebHID is not supported in this browser');
        }

        const filters = this._buildFilters();
        const devices = await navigator.hid.requestDevice({ filters });

        if (!devices || devices.length === 0) {
            throw new Error('No device selected');
        }

        this.device = devices[0];

        if (!this.device.opened) {
            await this.device.open();
        }

        // Listen for disconnect
        navigator.hid.addEventListener('disconnect', (event) => {
            if (event.device === this.device) {
                this.device = null;
                if (this._onDisconnect) {
                    this._onDisconnect();
                }
            }
        });

        return {
            vendorId: this.device.vendorId,
            productId: this.device.productId,
            productName: this.device.productName
        };
    }

    /**
     * Set a callback for when the device disconnects
     */
    onDisconnect(callback) {
        this._onDisconnect = callback;
    }

    /**
     * Close the device connection
     */
    async disconnect() {
        if (this.device && this.device.opened) {
            await this.device.close();
        }
        this.device = null;
    }

    /**
     * Read a feature report and return the DataView
     */
    async _getFeatureReport(reportName) {
        if (!this.connected) throw new Error('Not connected');
        const id = this._reportId(reportName);
        return await this.device.receiveFeatureReport(id);
    }

    /**
     * Send a feature report
     */
    async _sendFeatureReport(reportName, data) {
        if (!this.connected) throw new Error('Not connected');
        const id = this._reportId(reportName);
        const buffer = new Uint8Array(data);
        await this.device.sendFeatureReport(id, buffer);
    }

    /**
     * Decode a string from a DataView (null-terminated UTF-8)
     */
    _decodeString(dataView) {
        const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
        // Find null terminator
        let end = bytes.indexOf(0);
        if (end === -1) end = bytes.length;
        const decoder = new TextDecoder('utf-8');
        // Trim leading replacement characters (U+FFFD) that appear when the
        // report ID byte leaks into the data buffer on some HID stacks.
        return decoder.decode(bytes.slice(0, end)).replace(/^\uFFFD+/, '');
    }

    // ========================================================================
    // Device Info Queries
    // ========================================================================

    /** Read firmware version string (e.g., "1.0.5") */
    async getVersion() {
        const data = await this._getFeatureReport('version');
        return this._decodeString(data);
    }

    /** Read full git version string (e.g., "v1.0.5-3-gabcdef1") */
    async getVersionFull() {
        const data = await this._getFeatureReport('version_full');
        return this._decodeString(data);
    }

    /** Read build type string (e.g., "Release") */
    async getBuildType() {
        const data = await this._getFeatureReport('build_type');
        return this._decodeString(data);
    }

    /** Read board identity string (e.g., "americade_agc4p") */
    async getBoard() {
        const data = await this._getFeatureReport('board');
        return this._decodeString(data);
    }

    /** Read all device info at once */
    async getDeviceInfo() {
        const [version, versionFull, buildType, board] = await Promise.all([
            this.getVersion(),
            this.getVersionFull(),
            this.getBuildType(),
            this.getBoard()
        ]);
        return { version, versionFull, buildType, board };
    }

    // ========================================================================
    // Settings Read/Write
    // ========================================================================

    /**
     * Read current in-memory settings from device
     * Returns an object with field values keyed by name
     */
    async getSettings() {
        const data = await this._getFeatureReport('settings_get');
        return this._parseSettingsReport(data);
    }

    /**
     * Read flash-persisted settings from device
     * (For detecting unsaved changes)
     */
    async getFlashSettings() {
        const data = await this._getFeatureReport('settings_get_flash');
        return this._parseSettingsReport(data);
    }

    /**
     * Parse a settings feature report into a field-value object.
     *
     * WebHID's receiveFeatureReport returns a DataView whose first byte is the
     * report ID (per spec & Chrome's implementation).  The actual field data
     * starts at byte 1.  The config field offsets are 0-based relative to the
     * data portion, so we add a +1 byte offset to skip the report ID.
     */
    _parseSettingsReport(dataView) {
        const fields = this.config.settings.fields;
        const dataSize = this.config.settings.report_size - 1; // 7 data bytes
        const result = {};

        // Determine the data offset: if the DataView is larger than the data-only
        // size, the first byte is the report ID and we skip it.
        const dataOffset = (dataView.byteLength > dataSize) ? 1 : 0;

        for (const field of fields) {
            const bytePos = field.offset + dataOffset;
            if (bytePos < dataView.byteLength) {
                let value = dataView.getUint8(bytePos);
                if (field.type === 'bool') {
                    value = value !== 0;
                }
                result[field.name] = value;
            }
        }

        // Transpose wire color order → display RGB order
        this._wireToDisplayColor(result);

        return result;
    }

    /**
     * Transpose color channels from wire order to display RGB order.
     *
     * The device may store colors in a non-RGB order (e.g. GRB for WS2812).
     * The config's "color_order" string (default "rgb") defines the wire byte
     * order: each character maps to which display channel that wire position
     * carries.  For "grb": wire byte 0 = green, wire byte 1 = red, wire byte 2 = blue.
     *
     * This method converts from wire → display (for reading from device).
     */
    _wireToDisplayColor(settings) {
        const order = (this.config.settings.color_order || 'rgb').toLowerCase();
        if (order === 'rgb') return; // No transpose needed

        // Read the wire values (named r/g/b in the struct, but actually in wire order)
        const wire = [
            settings.rgb_color_r,  // wire position 0
            settings.rgb_color_g,  // wire position 1
            settings.rgb_color_b,  // wire position 2
        ];

        // Map: order string tells us which display channel each wire position holds
        const channelMap = { r: 0, g: 1, b: 2 };
        const display = [0, 0, 0]; // [R, G, B]
        for (let i = 0; i < 3; i++) {
            const ch = order[i]; // which display channel is at wire position i
            display[channelMap[ch]] = wire[i];
        }

        settings.rgb_color_r = display[0];
        settings.rgb_color_g = display[1];
        settings.rgb_color_b = display[2];
    }

    /**
     * Transpose color channels from display RGB order to wire order.
     * Inverse of _wireToDisplayColor (for writing to device).
     */
    _displayToWireColor(settings) {
        const order = (this.config.settings.color_order || 'rgb').toLowerCase();
        if (order === 'rgb') return settings;

        const display = [
            settings.rgb_color_r,  // display R
            settings.rgb_color_g,  // display G
            settings.rgb_color_b,  // display B
        ];

        // Reverse map: for each wire position, pick the display channel it expects
        const channelMap = { r: 0, g: 1, b: 2 };
        const wire = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
            const ch = order[i]; // which display channel goes into wire position i
            wire[i] = display[channelMap[ch]];
        }

        return {
            ...settings,
            rgb_color_r: wire[0],  // wire position 0
            rgb_color_g: wire[1],  // wire position 1
            rgb_color_b: wire[2],  // wire position 2
        };
    }

    /**
     * Send settings to device (applies immediately, does NOT save to flash)
     */
    async setSettings(settings) {
        const fields = this.config.settings.fields;
        // WebHID sends the report ID separately, so we only send the data
        // portion (report_size minus the 1-byte report_id prefix).
        const dataSize = this.config.settings.report_size - 1;
        const data = new Uint8Array(dataSize).fill(0);

        // Transpose display RGB → wire color order before writing
        const wireSettings = this._displayToWireColor(settings);

        for (const field of fields) {
            const value = wireSettings[field.name];
            if (value !== undefined) {
                let byteVal = field.type === 'bool' ? (value ? 1 : 0) : (value & 0xFF);
                data[field.offset] = byteVal;
            }
        }

        await this._sendFeatureReport('settings_set', data);
    }

    /**
     * Check if current settings differ from flash (unsaved changes)
     */
    async hasUnsavedChanges() {
        try {
            const [current, flash] = await Promise.all([
                this.getSettings(),
                this.getFlashSettings()
            ]);
            return JSON.stringify(current) !== JSON.stringify(flash);
        } catch {
            return false;
        }
    }

    // ========================================================================
    // Commands
    // ========================================================================

    /** Save current settings to flash */
    async save() {
        // WebHID sends report ID separately; only send data portion
        await this._sendFeatureReport('settings_save', new Uint8Array(this.config.settings.report_size - 1));
    }

    /** Reset settings to factory defaults */
    async reset() {
        // WebHID sends report ID separately; only send data portion
        await this._sendFeatureReport('settings_reset', new Uint8Array(this.config.settings.report_size - 1));
    }

    /** Enter BOOTSEL mode for firmware update (device will disconnect!) */
    async enterBootsel() {
        // WebHID sends report ID separately; only send data portion
        await this._sendFeatureReport('bootsel', new Uint8Array(this.config.settings.report_size - 1));
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Find device info matching the connected device's board name
     */
    findDeviceConfig(boardName) {
        if (!boardName) return null;
        const bnLower = boardName.toLowerCase();
        return this.config.devices.find(d =>
            d.board.toLowerCase() === bnLower ||
            d.target.toLowerCase() === bnLower
        ) || null;
    }

    /**
     * Get enum options for a named enum
     */
    getEnumOptions(enumName) {
        return this.config.enums[enumName] || [];
    }
}

// Export for use by app.js
window.PicoCTRDevice = PicoCTRDevice;
