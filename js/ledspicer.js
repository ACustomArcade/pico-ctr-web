/**
 * PicoCTR Web Configurator - LEDSpicer Configuration Tab
 *
 * Standalone (no device connection required) editor for ledspicer.conf.
 * The user assigns button names to connectors; each connector maps to a fixed
 * red/green/blue LED pin triple. Connectors, groups, and device/output settings
 * are rendered to a valid LEDSpicer XML configuration that can be copied or
 * downloaded. Existing ledspicer.conf files can be uploaded for editing.
 */

(function () {
    'use strict';

    // ========================================================================
    // Constants
    // ========================================================================

    // Connectors are numbered 1..NUM_CONNECTORS. Each drives one RGB LED whose
    // pins follow a fixed pattern (verified against the reference table):
    //   green = 3n - 2 , red = 3n - 1 , blue = 3n
    const NUM_CONNECTORS = 30;

    // Default attributes for a fresh configuration, taken from the reference
    // ledspicer.conf. Preserved verbatim when an existing file is uploaded.
    const DEFAULT_ROOT_ATTRS = {
        version: '1.0',
        type: 'Configuration',
        fps: '30',
        port: '16161',
        colors: 'basicColors',
        logLevel: 'Info',
        userId: '1000',
        groupId: '1000',
        craftProfile: 'true',
        dataSource: 'controls.ini, mame, file',
        colorsFile: 'true',
        randomColors: 'Red, Blue, Green, Yellow'
    };

    const DEFAULT_DEVICE = { name: 'Adalight', leds: '90', port: '/dev/ttyACM0' };
    const DEFAULT_LAYOUT_ATTRS = { defaultProfile: 'default' };

    // ========================================================================
    // State
    // ========================================================================

    const state = {
        rootAttrs: Object.assign({}, DEFAULT_ROOT_ATTRS),
        device: Object.assign({}, DEFAULT_DEVICE),
        layoutAttrs: Object.assign({}, DEFAULT_LAYOUT_ATTRS),
        // connectors[n] = array of button-name strings (n is 1-based)
        connectors: {},
        // groups = [{ name: string, elements: string[] }]
        groups: [],
        showEmpty: false,
        // When true, the device <port> attribute is omitted (LEDSpicer auto-detects).
        portAuto: true
    };

    // ========================================================================
    // DOM References
    // ========================================================================

    const $ = (sel) => document.querySelector(sel);

    let dom = null;

    function cacheDom() {
        dom = {
            tabBtns: document.querySelectorAll('.tab-btn'),
            panels: {
                device: $('#tab-device'),
                ledspicer: $('#tab-ledspicer')
            },
            importBtn: $('#ls-import-btn'),
            fileInput: $('#ls-file-input'),
            clearBtn: $('#ls-clear-btn'),
            importStatus: $('#ls-import-status'),
            portAuto: $('#ls-port-auto'),
            portRow: $('#ls-port-row'),
            devicePort: $('#ls-device-port'),
            showEmpty: $('#ls-show-empty'),
            connectors: $('#ls-connectors'),
            addGroup: $('#ls-add-group'),
            groups: $('#ls-groups'),
            noGroups: $('#ls-no-groups'),
            copy: $('#ls-copy'),
            download: $('#ls-download'),
            output: $('#ls-output')
        };
    }

    // ========================================================================
    // Pin mapping helpers
    // ========================================================================

    function pinsForConnector(n) {
        return { green: 3 * n - 2, red: 3 * n - 1, blue: 3 * n };
    }

    // Given an element's pins, recover the connector number. Uses blue (= 3n)
    // primarily, falling back to green/red. Returns null if it doesn't map to a
    // valid connector.
    function connectorFromPins(red, green, blue) {
        const candidates = [];
        if (Number.isFinite(blue)) candidates.push(blue / 3);
        if (Number.isFinite(green)) candidates.push((green + 2) / 3);
        if (Number.isFinite(red)) candidates.push((red + 1) / 3);
        for (const c of candidates) {
            if (Number.isInteger(c) && c >= 1 && c <= NUM_CONNECTORS) return c;
        }
        return null;
    }

    // ========================================================================
    // State mutation helpers
    // ========================================================================

    function allButtonNames() {
        const names = [];
        for (let n = 1; n <= NUM_CONNECTORS; n++) {
            const list = state.connectors[n];
            if (list) names.push(...list);
        }
        return names;
    }

    function addName(connector, rawName) {
        const name = (rawName || '').trim();
        if (!name) return false;
        const existing = allButtonNames();
        if (existing.includes(name)) {
            setImportStatus(`"${name}" is already in use. Button names must be unique.`, 'warn');
            return false;
        }
        if (!state.connectors[connector]) state.connectors[connector] = [];
        state.connectors[connector].push(name);
        return true;
    }

    function removeName(connector, name) {
        const list = state.connectors[connector];
        if (!list) return;
        const idx = list.indexOf(name);
        if (idx !== -1) list.splice(idx, 1);
        if (list.length === 0) delete state.connectors[connector];
        // Also drop it from any groups that referenced it.
        for (const g of state.groups) {
            const gi = g.elements.indexOf(name);
            if (gi !== -1) g.elements.splice(gi, 1);
        }
    }

    function clearAll() {
        state.connectors = {};
        state.groups = [];
        state.rootAttrs = Object.assign({}, DEFAULT_ROOT_ATTRS);
        state.device = Object.assign({}, DEFAULT_DEVICE);
        state.layoutAttrs = Object.assign({}, DEFAULT_LAYOUT_ATTRS);
        state.portAuto = true;
        syncSettingsInputsFromState();
        setImportStatus('', '');
        renderAll();
    }

    // ========================================================================
    // XML generation
    // ========================================================================

    function escapeXml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function generateXml() {
        const T = '        '; // 8-space indent unit, matching the reference file
        const lines = [];
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');

        // Root open with attributes
        lines.push('<LEDSpicer');
        for (const [k, v] of Object.entries(state.rootAttrs)) {
            lines.push(`${T}${k}="${escapeXml(v)}"`);
        }
        lines.push('>');

        // Devices
        lines.push(`${T}<devices>`);
        lines.push(`${T}${T}<device`);
        lines.push(`${T}${T}${T}name="${escapeXml(state.device.name)}"`);
        lines.push(`${T}${T}${T}leds="${escapeXml(state.device.leds)}"`);
        if (!state.portAuto) {
            lines.push(`${T}${T}${T}port="${escapeXml(state.device.port)}"`);
        }
        lines.push(`${T}${T}>`);

        for (let n = 1; n <= NUM_CONNECTORS; n++) {
            const list = state.connectors[n];
            if (!list || list.length === 0) continue;
            const p = pinsForConnector(n);
            for (const name of list) {
                lines.push(`${T}${T}${T}<element`);
                lines.push(`${T}${T}${T}${T}name="${escapeXml(name)}"`);
                lines.push(`${T}${T}${T}${T}red="${p.red}"`);
                lines.push(`${T}${T}${T}${T}green="${p.green}"`);
                lines.push(`${T}${T}${T}${T}blue="${p.blue}"`);
                lines.push(`${T}${T}${T}/>`);
            }
        }

        lines.push(`${T}${T}</device>`);
        lines.push(`${T}</devices>`);

        // Layout / groups
        const layoutAttrs = Object.entries(state.layoutAttrs)
            .map(([k, v]) => `${k}="${escapeXml(v)}"`)
            .join(' ');
        lines.push(`${T}<layout${layoutAttrs ? ' ' + layoutAttrs : ''}>`);
        for (const g of state.groups) {
            lines.push(`${T}${T}<group name="${escapeXml(g.name)}">`);
            for (const name of g.elements) {
                lines.push(`${T}${T}${T}<element name="${escapeXml(name)}"/>`);
            }
            lines.push(`${T}${T}</group>`);
        }
        lines.push(`${T}</layout>`);

        lines.push('</LEDSpicer>');
        return lines.join('\n') + '\n';
    }

    // ========================================================================
    // XML parsing (upload)
    // ========================================================================

    function parseConf(text) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'application/xml');

        if (doc.querySelector('parsererror')) {
            throw new Error('File is not valid XML.');
        }
        const root = doc.querySelector('LEDSpicer');
        if (!root) {
            throw new Error('No <LEDSpicer> root element found.');
        }

        // Build fresh state, preserving unknown attributes.
        const next = {
            rootAttrs: Object.assign({}, DEFAULT_ROOT_ATTRS),
            device: Object.assign({}, DEFAULT_DEVICE),
            layoutAttrs: Object.assign({}, DEFAULT_LAYOUT_ATTRS),
            connectors: {},
            groups: [],
            // Default to auto unless the device explicitly declares a port.
            portAuto: true
        };

        for (const attr of root.attributes) {
            next.rootAttrs[attr.name] = attr.value;
        }

        const device = root.querySelector('devices > device');
        if (device) {
            for (const attr of device.attributes) {
                next.device[attr.name] = attr.value;
            }
            next.portAuto = !device.hasAttribute('port');
            let unmapped = 0;
            for (const el of device.querySelectorAll('element')) {
                const name = el.getAttribute('name');
                if (!name) continue;
                const red = parseInt(el.getAttribute('red'), 10);
                const green = parseInt(el.getAttribute('green'), 10);
                const blue = parseInt(el.getAttribute('blue'), 10);
                const connector = connectorFromPins(red, green, blue);
                if (connector === null) { unmapped++; continue; }
                if (!next.connectors[connector]) next.connectors[connector] = [];
                if (!next.connectors[connector].includes(name)) {
                    next.connectors[connector].push(name);
                }
            }
            if (unmapped > 0) {
                next._warning = `${unmapped} element(s) had pin values outside the connector range and were skipped.`;
            }
        }

        const layout = root.querySelector('layout');
        if (layout) {
            next.layoutAttrs = {};
            for (const attr of layout.attributes) {
                next.layoutAttrs[attr.name] = attr.value;
            }
            for (const groupEl of layout.querySelectorAll('group')) {
                const gName = groupEl.getAttribute('name') || 'group';
                const elements = [];
                for (const ref of groupEl.querySelectorAll('element')) {
                    const refName = ref.getAttribute('name');
                    if (refName) elements.push(refName);
                }
                next.groups.push({ name: gName, elements });
            }
        }

        return next;
    }

    function handleFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = parseConf(reader.result);
                state.rootAttrs = parsed.rootAttrs;
                state.device = parsed.device;
                state.layoutAttrs = parsed.layoutAttrs;
                state.connectors = parsed.connectors;
                state.groups = parsed.groups;
                state.portAuto = parsed.portAuto;
                syncSettingsInputsFromState();
                renderAll();
                const count = allButtonNames().length;
                const msg = parsed._warning
                    ? `Loaded ${count} button(s). ${parsed._warning}`
                    : `Loaded ${count} button(s) across ${state.groups.length} group(s).`;
                setImportStatus(msg, parsed._warning ? 'warn' : 'ok');
            } catch (err) {
                setImportStatus(`Could not load file: ${err.message}`, 'error');
            }
        };
        reader.onerror = () => setImportStatus('Could not read file.', 'error');
        reader.readAsText(file);
    }

    function setImportStatus(message, kind) {
        if (!dom.importStatus) return;
        if (!message) {
            dom.importStatus.style.display = 'none';
            dom.importStatus.textContent = '';
            return;
        }
        dom.importStatus.style.display = '';
        dom.importStatus.textContent = message;
        dom.importStatus.className = 'ls-import-status' + (kind ? ' ls-import-status--' + kind : '');
    }

    // ========================================================================
    // Settings <-> inputs sync
    // ========================================================================

    function syncSettingsInputsFromState() {
        dom.portAuto.checked = state.portAuto;
        dom.devicePort.value = state.device.port || '';
        dom.portRow.style.display = state.portAuto ? 'none' : '';
    }

    function onPortAutoChange() {
        state.portAuto = dom.portAuto.checked;
        dom.portRow.style.display = state.portAuto ? 'none' : '';
        renderOutput();
    }

    function onPortInput() {
        state.device.port = dom.devicePort.value;
        renderOutput();
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    function renderAll() {
        renderConnectors();
        renderGroups();
        renderOutput();
    }

    function renderConnectors() {
        const frag = document.createDocumentFragment();
        for (let n = 1; n <= NUM_CONNECTORS; n++) {
            const list = state.connectors[n] || [];
            if (list.length === 0 && !state.showEmpty) continue;
            frag.appendChild(buildConnectorRow(n, list));
        }
        dom.connectors.innerHTML = '';
        if (!frag.childNodes.length) {
            const hint = document.createElement('p');
            hint.className = 'ls-empty-hint';
            hint.textContent = 'No buttons assigned yet. Enable "Show empty connectors" to start adding names.';
            dom.connectors.appendChild(hint);
        } else {
            dom.connectors.appendChild(frag);
        }
    }

    function buildConnectorRow(n, list) {
        const row = document.createElement('div');
        row.className = 'ls-connector';

        const header = document.createElement('div');
        header.className = 'ls-connector-head';
        const label = document.createElement('span');
        label.className = 'ls-connector-label';
        label.textContent = `Connector ${n}`;
        header.appendChild(label);
        row.appendChild(header);

        const chips = document.createElement('div');
        chips.className = 'ls-chips';
        for (const name of list) {
            const chip = document.createElement('span');
            chip.className = 'ls-chip';
            const text = document.createElement('span');
            text.textContent = name;
            chip.appendChild(text);
            const remove = document.createElement('button');
            remove.className = 'ls-chip-remove';
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove ${name}`);
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                removeName(n, name);
                renderAll();
            });
            chip.appendChild(remove);
            chips.appendChild(chip);
        }
        row.appendChild(chips);

        const addWrap = document.createElement('div');
        addWrap.className = 'ls-add-name';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input form-input-small';
        input.placeholder = 'Button name (e.g. P1_BUTTON1)';
        const commit = () => {
            if (addName(n, input.value)) {
                input.value = '';
                renderAll();
                // Re-focus the (newly rendered) input for this connector.
                const fresh = dom.connectors.querySelector(`[data-connector="${n}"] input`);
                if (fresh) fresh.focus();
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
        });
        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-small btn-ghost';
        addBtn.type = 'button';
        addBtn.textContent = 'Add';
        addBtn.addEventListener('click', commit);
        addWrap.appendChild(input);
        addWrap.appendChild(addBtn);
        row.appendChild(addWrap);

        row.dataset.connector = String(n);
        return row;
    }

    function renderGroups() {
        dom.groups.innerHTML = '';
        dom.noGroups.style.display = state.groups.length ? 'none' : '';
        const names = allButtonNames();
        state.groups.forEach((group, gi) => {
            dom.groups.appendChild(buildGroupCard(group, gi, names));
        });
    }

    function buildGroupCard(group, gi, names) {
        const card = document.createElement('div');
        card.className = 'ls-group';

        const head = document.createElement('div');
        head.className = 'ls-group-head';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'form-input';
        nameInput.value = group.name;
        nameInput.placeholder = 'Group name (e.g. player 1)';
        nameInput.addEventListener('input', () => {
            group.name = nameInput.value;
            renderOutput();
        });
        head.appendChild(nameInput);

        const del = document.createElement('button');
        del.className = 'btn btn-small btn-ghost ls-group-delete';
        del.type = 'button';
        del.title = 'Delete group';
        del.innerHTML = '<span class="btn-icon">🗑️</span>';
        del.addEventListener('click', () => {
            state.groups.splice(gi, 1);
            renderGroups();
            renderOutput();
        });
        head.appendChild(del);
        card.appendChild(head);

        if (names.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'ls-empty-hint';
            hint.textContent = 'Add button names to connectors first, then select them here.';
            card.appendChild(hint);
            return card;
        }

        const grid = document.createElement('div');
        grid.className = 'ls-group-members';
        for (const name of names) {
            const lbl = document.createElement('label');
            lbl.className = 'ls-checkbox-label';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = group.elements.includes(name);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!group.elements.includes(name)) group.elements.push(name);
                } else {
                    const idx = group.elements.indexOf(name);
                    if (idx !== -1) group.elements.splice(idx, 1);
                }
                renderOutput();
            });
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(' ' + name));
            grid.appendChild(lbl);
        }
        card.appendChild(grid);
        return card;
    }

    function renderOutput() {
        if (dom.output) dom.output.textContent = generateXml();
    }

    // ========================================================================
    // Tab switching
    // ========================================================================

    function switchTab(tab) {
        dom.tabBtns.forEach((btn) => {
            const active = btn.dataset.tab === tab;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        Object.entries(dom.panels).forEach(([name, el]) => {
            if (el) el.hidden = name !== tab;
        });
    }

    // ========================================================================
    // Download / copy
    // ========================================================================

    function downloadConf() {
        const blob = new Blob([generateXml()], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ledspicer.conf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function copyConf() {
        const text = generateXml();
        try {
            await navigator.clipboard.writeText(text);
            flashButton(dom.copy, 'Copied!');
        } catch (_) {
            // Fallback for non-secure contexts / older browsers.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); flashButton(dom.copy, 'Copied!'); }
            catch (_) { flashButton(dom.copy, 'Copy failed'); }
            document.body.removeChild(ta);
        }
    }

    function flashButton(btn, msg) {
        if (!btn) return;
        const original = btn.innerHTML;
        btn.textContent = msg;
        setTimeout(() => { btn.innerHTML = original; }, 1200);
    }

    // ========================================================================
    // Init
    // ========================================================================

    function init() {
        cacheDom();
        if (!dom.panels.ledspicer) return; // tab not present

        // Tab buttons
        dom.tabBtns.forEach((btn) => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Import / clear
        dom.importBtn.addEventListener('click', () => dom.fileInput.click());
        dom.fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) handleFile(file);
            e.target.value = ''; // allow re-upload of same file
        });
        dom.clearBtn.addEventListener('click', clearAll);

        // Output settings
        dom.portAuto.addEventListener('change', onPortAutoChange);
        dom.devicePort.addEventListener('input', onPortInput);

        // Show empty connectors toggle
        dom.showEmpty.addEventListener('change', () => {
            state.showEmpty = dom.showEmpty.checked;
            renderConnectors();
        });

        // Groups
        dom.addGroup.addEventListener('click', () => {
            state.groups.push({ name: `group ${state.groups.length + 1}`, elements: [] });
            renderGroups();
            renderOutput();
        });

        // Output actions
        dom.copy.addEventListener('click', copyConf);
        dom.download.addEventListener('click', downloadConf);

        syncSettingsInputsFromState();
        renderAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
