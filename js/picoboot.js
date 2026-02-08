/**
 * PicoCTR PICOBOOT WebUSB Flasher
 *
 * Implements the RP2040 PICOBOOT protocol over WebUSB to flash UF2 firmware
 * directly from the browser without needing a USB mass storage driver.
 *
 * Protocol reference: pico-sdk/src/common/boot_picoboot_headers/include/boot/picoboot.h
 * Implementation reference: picotool/picoboot_connection/picoboot_connection.c
 */

// eslint-disable-next-line no-unused-vars
class PicobootConnection {
    // RP2040/RP2350 BOOTSEL USB IDs
    static VENDOR_ID = 0x2E8A;
    static PRODUCT_ID_RP2040 = 0x0003;
    static PRODUCT_ID_RP2350 = 0x000F;

    // PICOBOOT protocol constants
    static PICOBOOT_MAGIC = 0x431FD10B;
    static PICOBOOT_IF_RESET = 0x41;      // vendor OUT control request
    static PICOBOOT_IF_CMD_STATUS = 0x42;  // vendor IN control request

    // Command IDs
    static CMD = {
        EXCLUSIVE_ACCESS: 0x01,
        REBOOT:           0x02,
        FLASH_ERASE:      0x03,
        READ:             0x84,  // bit 7 set = device-to-host
        WRITE:            0x05,
        EXIT_XIP:         0x06,
        ENTER_CMD_XIP:    0x07,
        EXEC:             0x08,
        VECTORIZE_FLASH:  0x09,
    };

    // UF2 constants
    static UF2_MAGIC_START0 = 0x0A324655;  // "UF2\n"
    static UF2_MAGIC_START1 = 0x9E5D5157;
    static UF2_MAGIC_END    = 0x0AB16F30;
    static UF2_FLAG_FAMILY  = 0x00002000;
    static RP2040_FAMILY_ID = 0xE48BFF56;
    static RP2350_ARM_S_FAMILY_ID  = 0xE48BFF59;
    static RP2350_ARM_NS_FAMILY_ID = 0xE48BFF5A;
    static RP2350_RISCV_FAMILY_ID  = 0xE48BFF5B;
    static UF2_BLOCK_SIZE = 512;

    // Flash geometry
    static FLASH_SECTOR_SIZE = 4096;   // 4 KB erase sector
    static FLASH_PAGE_SIZE   = 256;    // 256-byte write page

    // Maximum retry attempts for stall recovery (matches picotool's wrap_call pattern)
    static MAX_RETRIES = 3;

    constructor() {
        this._device = null;
        this._interfaceNumber = -1;
        this._endpointIn = -1;
        this._endpointOut = -1;
        this._token = 1;
    }

    /**
     * Check if WebUSB is supported in this browser.
     */
    static isSupported() {
        return !!navigator.usb;
    }

    /**
     * Request and connect to a device in BOOTSEL mode.
     * @returns {Promise<USBDevice>}
     */
    async connect() {
        this._device = await navigator.usb.requestDevice({
            filters: [
                { vendorId: PicobootConnection.VENDOR_ID, productId: PicobootConnection.PRODUCT_ID_RP2040 },
                { vendorId: PicobootConnection.VENDOR_ID, productId: PicobootConnection.PRODUCT_ID_RP2350 },
            ]
        });

        await this._device.open();

        // Select configuration 1 if not already selected
        if (!this._device.configuration || this._device.configuration.configurationValue !== 1) {
            await this._device.selectConfiguration(1);
        }

        // Find the PICOBOOT interface.
        // picotool logic: class=0xFF with 2 bulk endpoints.
        // If 1 interface, it's index 0; if multiple, it's index 1.
        // Do NOT check subclass/protocol — picotool doesn't either.
        const config = this._device.configuration;
        let found = false;

        for (const iface of config.interfaces) {
            const alt = iface.alternates[0];
            if (alt.interfaceClass === 0xFF) {
                const bulkEndpoints = alt.endpoints.filter(ep => ep.type === 'bulk');
                if (bulkEndpoints.length >= 2) {
                    this._interfaceNumber = iface.interfaceNumber;
                    for (const ep of bulkEndpoints) {
                        if (ep.direction === 'in')  this._endpointIn = ep.endpointNumber;
                        if (ep.direction === 'out') this._endpointOut = ep.endpointNumber;
                    }
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            // Fallback: use interface 1 if it exists (RP2040 standard layout)
            const fallbackIdx = config.interfaces.length > 1 ? 1 : 0;
            const iface = config.interfaces[fallbackIdx];
            if (iface) {
                this._interfaceNumber = iface.interfaceNumber;
                const alt = iface.alternates[0];
                for (const ep of alt.endpoints) {
                    if (ep.type === 'bulk' && ep.direction === 'in')  this._endpointIn = ep.endpointNumber;
                    if (ep.type === 'bulk' && ep.direction === 'out') this._endpointOut = ep.endpointNumber;
                }
            }
        }

        if (this._endpointIn < 0 || this._endpointOut < 0) {
            throw new Error('Could not find PICOBOOT bulk endpoints');
        }

        await this._device.claimInterface(this._interfaceNumber);

        // Reset the interface (clears halts + sends IF_RESET, matching picotool's init)
        await this._resetInterface();

        return this._device;
    }

    /**
     * Disconnect from the device.
     */
    async disconnect() {
        if (this._device) {
            try {
                await this._device.releaseInterface(this._interfaceNumber);
                await this._device.close();
            } catch (_) {
                // Ignore errors during disconnect
            }
            this._device = null;
        }
    }

    /**
     * Listen for device disconnect.
     * @param {Function} callback
     */
    onDisconnect(callback) {
        navigator.usb.addEventListener('disconnect', (event) => {
            if (event.device === this._device) {
                this._device = null;
                callback();
            }
        });
    }

    // ========================================================================
    // Low-level PICOBOOT protocol
    // ========================================================================

    /**
     * Reset the PICOBOOT interface.
     * Matches picotool's picoboot_reset(): clear halts on both endpoints,
     * then send the IF_RESET vendor control request.
     */
    async _resetInterface() {
        // Clear any stalled endpoints first (critical for recovery)
        try { await this._device.clearHalt('in', this._endpointIn); } catch (_) { /* may not be halted */ }
        try { await this._device.clearHalt('out', this._endpointOut); } catch (_) { /* may not be halted */ }

        // Send IF_RESET vendor control request
        await this._device.controlTransferOut({
            requestType: 'vendor',
            recipient: 'interface',
            request: PicobootConnection.PICOBOOT_IF_RESET,
            value: 0,
            index: this._interfaceNumber,
        });
    }

    /**
     * Get command status (16-byte response).
     * @returns {Promise<DataView>}
     */
    async _getStatus() {
        const result = await this._device.controlTransferIn({
            requestType: 'vendor',
            recipient: 'interface',
            request: PicobootConnection.PICOBOOT_IF_CMD_STATUS,
            value: 0,
            index: this._interfaceNumber,
        }, 16);

        if (result.status !== 'ok') {
            throw new Error(`CMD_STATUS failed: ${result.status}`);
        }
        return result.data;
    }

    /**
     * Build a 32-byte PICOBOOT command buffer.
     *
     * struct picoboot_cmd {
     *     uint32_t dMagic;          // 0x431FD10B
     *     uint32_t dToken;          // incrementing token
     *     uint8_t  bCmdId;          // command ID
     *     uint8_t  bCmdSize;        // size of args after this header (max 16)
     *     uint16_t _unused;
     *     uint32_t dTransferLength; // length of following data transfer
     *     // union of command args (16 bytes)
     * };
     */
    _buildCommand(cmdId, transferLength, args) {
        const buf = new ArrayBuffer(32);
        const view = new DataView(buf);

        view.setUint32(0, PicobootConnection.PICOBOOT_MAGIC, true);  // dMagic
        view.setUint32(4, this._token++, true);                       // dToken
        view.setUint8(8, cmdId);                                       // bCmdId
        view.setUint8(9, args ? args.byteLength : 0);                 // bCmdSize
        view.setUint16(10, 0, true);                                   // _unused
        view.setUint32(12, transferLength, true);                      // dTransferLength

        // Copy command args into offset 16..31
        if (args) {
            const argsBytes = new Uint8Array(args);
            const cmdBytes = new Uint8Array(buf);
            cmdBytes.set(argsBytes.slice(0, 16), 16);
        }

        return buf;
    }

    /**
     * Send a PICOBOOT command and optionally transfer data.
     * Includes stall recovery matching picotool's wrap_call pattern:
     * on stall → reset interface (clear halts + IF_RESET) → retry.
     *
     * @param {number} cmdId - Command ID
     * @param {ArrayBuffer|null} args - Command arguments (up to 16 bytes)
     * @param {ArrayBuffer|null} data - Data to send (for write commands) or expected receive length
     * @param {boolean} isDeviceToHost - True if data flows from device to host
     * @returns {Promise<ArrayBuffer|null>} - Response data for device-to-host commands
     */
    async _sendCommand(cmdId, args = null, data = null, isDeviceToHost = false) {
        for (let attempt = 0; attempt < PicobootConnection.MAX_RETRIES; attempt++) {
            try {
                return await this._sendCommandOnce(cmdId, args, data, isDeviceToHost);
            } catch (err) {
                const isStall = err.message?.includes('stall');
                if (isStall && attempt < PicobootConnection.MAX_RETRIES - 1) {
                    // Stall recovery: reset interface and retry (matches picotool)
                    console.warn(`PICOBOOT stall on attempt ${attempt + 1}, resetting and retrying...`);
                    try { await this._resetInterface(); } catch (_) { /* best effort */ }
                    continue;
                }
                throw err;
            }
        }
    }

    /**
     * Single attempt to send a PICOBOOT command.
     * Protocol flow matches picotool's picoboot_cmd():
     *   1. Bulk OUT: 32-byte command
     *   2. (optional) Bulk IN/OUT: data transfer
     *   3. ACK: zero-length packet in opposite direction of data
     *      - host-to-device cmd → ACK via Bulk IN
     *      - device-to-host cmd (bit7 set) → ACK via Bulk OUT
     *      - no-data cmd → ACK via Bulk IN
     */
    async _sendCommandOnce(cmdId, args, data, isDeviceToHost) {
        const transferLength = data ? (isDeviceToHost ? data : data.byteLength) : 0;
        const cmd = this._buildCommand(cmdId, typeof transferLength === 'number' ? transferLength : 0, args);

        // Step 1: Send the 32-byte command via bulk OUT
        let result = await this._device.transferOut(this._endpointOut, cmd);
        if (result.status !== 'ok') {
            throw new Error(`Command send failed: ${result.status}`);
        }

        let responseData = null;

        // Step 2: Data transfer phase
        if (isDeviceToHost && typeof data === 'number' && data > 0) {
            // Device-to-host data transfer (read)
            const inResult = await this._device.transferIn(this._endpointIn, data);
            if (inResult.status !== 'ok') {
                throw new Error(`Data receive failed: ${inResult.status}`);
            }
            responseData = inResult.data.buffer;
        } else if (!isDeviceToHost && data && data.byteLength > 0) {
            // Host-to-device data transfer (write)
            result = await this._device.transferOut(this._endpointOut, data);
            if (result.status !== 'ok') {
                throw new Error(`Data send failed: ${result.status}`);
            }
        }

        // Step 3: ACK — opposite direction to data flow
        // picotool: device-to-host cmd (bit7 set) → zero-length OUT
        //           host-to-device cmd → zero-length IN
        try {
            if (cmdId & 0x80) {
                // Device-to-host command: ACK goes OUT
                await this._device.transferOut(this._endpointOut, new ArrayBuffer(0));
            } else {
                // Host-to-device / no-data command: ACK comes IN
                await this._device.transferIn(this._endpointIn, 1);
            }
        } catch (_) {
            // Zero-length packet handling varies by platform; OK to swallow
        }

        return responseData;
    }

    // ========================================================================
    // PICOBOOT commands
    // ========================================================================

    /**
     * Request exclusive access to the flash.
     * @param {boolean} exclusive - true to acquire, false to release
     */
    async exclusiveAccess(exclusive) {
        // picoboot_exclusive_cmd is 1 byte: { uint8_t bExclusive; }
        const args = new ArrayBuffer(1);
        new DataView(args).setUint8(0, exclusive ? 1 : 0);
        await this._sendCommand(PicobootConnection.CMD.EXCLUSIVE_ACCESS, args);
    }

    /**
     * Exit XIP (execute-in-place) mode to allow flash operations.
     */
    async exitXip() {
        await this._sendCommand(PicobootConnection.CMD.EXIT_XIP);
    }

    /**
     * Erase flash sectors.
     * @param {number} addr - Start address (must be sector-aligned)
     * @param {number} length - Number of bytes to erase (must be sector-aligned)
     */
    async flashErase(addr, length) {
        const args = new ArrayBuffer(8);
        const view = new DataView(args);
        view.setUint32(0, addr, true);
        view.setUint32(4, length, true);
        await this._sendCommand(PicobootConnection.CMD.FLASH_ERASE, args);
    }

    /**
     * Write data to flash.
     * @param {number} addr - Start address (must be page-aligned)
     * @param {ArrayBuffer} data - Data to write (max 256 bytes per call)
     */
    async flashWrite(addr, data) {
        // picoboot_write sets dTransferLength = len AND range_cmd.dSize = len
        const args = new ArrayBuffer(8);
        const view = new DataView(args);
        view.setUint32(0, addr, true);
        view.setUint32(4, data instanceof ArrayBuffer ? data.byteLength : data.length, true);
        // Ensure we pass an ArrayBuffer
        const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        await this._sendCommand(PicobootConnection.CMD.WRITE, args, buf, false);
    }

    /**
     * Read data from flash.
     * @param {number} addr - Start address
     * @param {number} length - Number of bytes to read
     * @returns {Promise<ArrayBuffer>}
     */
    async flashRead(addr, length) {
        const args = new ArrayBuffer(8);
        const view = new DataView(args);
        view.setUint32(0, addr, true);
        view.setUint32(4, length, true);
        return await this._sendCommand(PicobootConnection.CMD.READ, args, length, true);
    }

    /**
     * Reboot the device.
     * @param {number} pc - Program counter (0 for default boot)
     * @param {number} sp - Stack pointer (0 for default)
     * @param {number} delayMs - Delay in milliseconds before reboot
     */
    async reboot(pc = 0, sp = 0, delayMs = 500) {
        const args = new ArrayBuffer(12);
        const view = new DataView(args);
        view.setUint32(0, pc, true);
        view.setUint32(4, sp, true);
        view.setUint32(8, delayMs, true);
        try {
            await this._sendCommand(PicobootConnection.CMD.REBOOT, args);
        } catch (_) {
            // Device disconnects immediately on reboot, errors expected
        }
    }

    // ========================================================================
    // UF2 Parser
    // ========================================================================

    /**
     * Parse a UF2 file into flash write operations.
     * @param {ArrayBuffer} uf2Data - Raw UF2 file data
     * @returns {{ blocks: Array<{addr: number, data: Uint8Array}>, familyId: number, totalBlocks: number }}
     */
    static parseUF2(uf2Data) {
        const data = new Uint8Array(uf2Data);
        const totalFileSize = data.length;

        if (totalFileSize % PicobootConnection.UF2_BLOCK_SIZE !== 0) {
            throw new Error(`Invalid UF2 file: size ${totalFileSize} is not a multiple of ${PicobootConnection.UF2_BLOCK_SIZE}`);
        }

        const numBlocks = totalFileSize / PicobootConnection.UF2_BLOCK_SIZE;
        const blocks = [];
        let familyId = 0;

        for (let i = 0; i < numBlocks; i++) {
            const offset = i * PicobootConnection.UF2_BLOCK_SIZE;
            const view = new DataView(uf2Data, offset, PicobootConnection.UF2_BLOCK_SIZE);

            // Validate magic numbers
            const magic0 = view.getUint32(0, true);
            const magic1 = view.getUint32(4, true);
            const magicEnd = view.getUint32(PicobootConnection.UF2_BLOCK_SIZE - 4, true);

            if (magic0 !== PicobootConnection.UF2_MAGIC_START0) {
                throw new Error(`Invalid UF2 block ${i}: bad magic0 (0x${magic0.toString(16)})`);
            }
            if (magic1 !== PicobootConnection.UF2_MAGIC_START1) {
                throw new Error(`Invalid UF2 block ${i}: bad magic1 (0x${magic1.toString(16)})`);
            }
            if (magicEnd !== PicobootConnection.UF2_MAGIC_END) {
                throw new Error(`Invalid UF2 block ${i}: bad end magic (0x${magicEnd.toString(16)})`);
            }

            const flags = view.getUint32(8, true);
            const targetAddr = view.getUint32(12, true);
            const payloadSize = view.getUint32(16, true);
            const blockNo = view.getUint32(20, true);
            const numBlocksInFile = view.getUint32(24, true);
            const blockFamilyId = view.getUint32(28, true);

            // Check family ID
            if (flags & PicobootConnection.UF2_FLAG_FAMILY) {
                if (i === 0) {
                    familyId = blockFamilyId;
                } else if (blockFamilyId !== familyId) {
                    throw new Error(`UF2 block ${i}: inconsistent family ID`);
                }
            }

            // Extract payload data (starts at offset 32 in the block)
            const payload = data.slice(offset + 32, offset + 32 + payloadSize);

            blocks.push({
                addr: targetAddr,
                data: payload,
                blockNo,
                numBlocks: numBlocksInFile,
            });
        }

        // Validate family ID for RP2040/RP2350
        const validFamilies = [
            PicobootConnection.RP2040_FAMILY_ID,
            PicobootConnection.RP2350_ARM_S_FAMILY_ID,
            PicobootConnection.RP2350_ARM_NS_FAMILY_ID,
            PicobootConnection.RP2350_RISCV_FAMILY_ID,
        ];

        if (familyId && !validFamilies.includes(familyId)) {
            throw new Error(`UF2 family ID 0x${familyId.toString(16).toUpperCase()} is not an RP2040/RP2350 firmware`);
        }

        return { blocks, familyId, totalBlocks: numBlocks };
    }

    /**
     * Get human-readable info about a UF2 file.
     * @param {ArrayBuffer} uf2Data
     * @returns {{ blocks: number, familyId: string, minAddr: string, maxAddr: string, totalSize: number }}
     */
    static getUF2Info(uf2Data) {
        const parsed = PicobootConnection.parseUF2(uf2Data);

        const familyNames = {
            [PicobootConnection.RP2040_FAMILY_ID]: 'RP2040',
            [PicobootConnection.RP2350_ARM_S_FAMILY_ID]: 'RP2350 (ARM-S)',
            [PicobootConnection.RP2350_ARM_NS_FAMILY_ID]: 'RP2350 (ARM-NS)',
            [PicobootConnection.RP2350_RISCV_FAMILY_ID]: 'RP2350 (RISC-V)',
        };

        let minAddr = Infinity, maxAddr = 0;
        let totalPayload = 0;
        for (const block of parsed.blocks) {
            minAddr = Math.min(minAddr, block.addr);
            maxAddr = Math.max(maxAddr, block.addr + block.data.length);
            totalPayload += block.data.length;
        }

        return {
            blocks: parsed.totalBlocks,
            familyId: familyNames[parsed.familyId] || `Unknown (0x${parsed.familyId.toString(16).toUpperCase()})`,
            minAddr: `0x${minAddr.toString(16).toUpperCase()}`,
            maxAddr: `0x${maxAddr.toString(16).toUpperCase()}`,
            totalSize: totalPayload,
        };
    }

    // ========================================================================
    // High-level flash operations
    // ========================================================================

    /**
     * Compute the erase ranges needed for a set of UF2 blocks.
     * Groups contiguous/overlapping sectors together.
     * @param {Array<{addr: number, data: Uint8Array}>} blocks
     * @returns {Array<{addr: number, length: number}>}
     */
    static _computeEraseRanges(blocks) {
        // Collect all sectors that need erasing
        const sectors = new Set();
        for (const block of blocks) {
            const startSector = Math.floor(block.addr / PicobootConnection.FLASH_SECTOR_SIZE) * PicobootConnection.FLASH_SECTOR_SIZE;
            const endAddr = block.addr + block.data.length;
            for (let s = startSector; s < endAddr; s += PicobootConnection.FLASH_SECTOR_SIZE) {
                sectors.add(s);
            }
        }

        // Sort and merge contiguous sectors into ranges
        const sorted = Array.from(sectors).sort((a, b) => a - b);
        if (sorted.length === 0) return [];

        const ranges = [];
        let rangeStart = sorted[0];
        let rangeEnd = sorted[0] + PicobootConnection.FLASH_SECTOR_SIZE;

        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === rangeEnd) {
                rangeEnd += PicobootConnection.FLASH_SECTOR_SIZE;
            } else {
                ranges.push({ addr: rangeStart, length: rangeEnd - rangeStart });
                rangeStart = sorted[i];
                rangeEnd = sorted[i] + PicobootConnection.FLASH_SECTOR_SIZE;
            }
        }
        ranges.push({ addr: rangeStart, length: rangeEnd - rangeStart });

        return ranges;
    }

    /**
     * Flash a UF2 firmware image to the device.
     *
     * @param {ArrayBuffer} uf2Data - The UF2 file data
     * @param {Function} onProgress - Callback: (phase, current, total, message) => void
     *   phase: 'parse' | 'erase' | 'write' | 'reboot' | 'done' | 'error'
     * @returns {Promise<void>}
     */
    async flashUF2(uf2Data, onProgress = () => {}) {
        try {
            // Phase 1: Parse UF2
            onProgress('parse', 0, 1, 'Parsing UF2 file...');
            const { blocks } = PicobootConnection.parseUF2(uf2Data);

            if (blocks.length === 0) {
                throw new Error('UF2 file contains no data blocks');
            }

            // Sort blocks by address for sequential writing
            blocks.sort((a, b) => a.addr - b.addr);
            onProgress('parse', 1, 1, `Parsed ${blocks.length} blocks`);

            // Phase 2: Prepare flash
            onProgress('erase', 0, 1, 'Preparing flash...');
            await this.exclusiveAccess(true);
            await this.exitXip();

            // Phase 3: Erase sectors
            const eraseRanges = PicobootConnection._computeEraseRanges(blocks);
            const totalEraseSectors = eraseRanges.reduce((sum, r) => sum + r.length / PicobootConnection.FLASH_SECTOR_SIZE, 0);
            let erasedSectors = 0;

            for (const range of eraseRanges) {
                const numSectors = range.length / PicobootConnection.FLASH_SECTOR_SIZE;
                onProgress('erase', erasedSectors, totalEraseSectors,
                    `Erasing 0x${range.addr.toString(16).toUpperCase()} (${numSectors} sectors)...`);

                await this.flashErase(range.addr, range.length);
                erasedSectors += numSectors;
            }
            onProgress('erase', totalEraseSectors, totalEraseSectors, `Erased ${totalEraseSectors} sectors`);

            // Phase 4: Write pages
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                onProgress('write', i, blocks.length,
                    `Writing block ${i + 1}/${blocks.length} @ 0x${block.addr.toString(16).toUpperCase()}...`);

                // Write data in FLASH_PAGE_SIZE (256-byte) chunks
                for (let offset = 0; offset < block.data.length; offset += PicobootConnection.FLASH_PAGE_SIZE) {
                    const chunk = block.data.slice(offset, offset + PicobootConnection.FLASH_PAGE_SIZE);
                    await this.flashWrite(block.addr + offset, chunk);
                }
            }
            onProgress('write', blocks.length, blocks.length, `Wrote ${blocks.length} blocks`);

            // Phase 5: Reboot
            onProgress('reboot', 0, 1, 'Rebooting device...');
            await this.reboot(0, 0, 500);
            onProgress('done', 1, 1, 'Firmware update complete! Device is rebooting.');

        } catch (err) {
            onProgress('error', 0, 1, `Error: ${err.message}`);
            throw err;
        }
    }
}
