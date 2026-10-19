// Extension Organizer: search / sort / filter / hide built-ins + fixed "Update all" / "Update enabled"
// in the "Manage extensions" popup. DOM-only, no imports, so it survives most core refactors.
(function () {
    'use strict';

    const MODULE = 'extension_organizer';
    const CONCURRENCY = 3;
    const UPDATE_TIMEOUT_MS = 60_000;

    const ctx = () => SillyTavern.getContext();

    function settings() {
        const store = ctx().extensionSettings;
        store[MODULE] ??= {};
        const s = store[MODULE];
        s.hideBuiltIn ??= false;
        s.sort ??= 'default';
        s.filter ??= 'all';
        s.firstSeen ??= {};
        return s;
    }
    const save = () => ctx().saveSettingsDebounced();

    // ---- block helpers (read straight from the core DOM) ----
    const toggleOf = b => b.querySelector('.extension_toggle input');
    const isThirdParty = b => (toggleOf(b)?.dataset.name ?? '').startsWith('third-party');
    const isEnabled = b => !!toggleOf(b)?.checked;
    const isGlobal = b => !!b.querySelector('.extension_icon .fa-server');
    const hasUpdate = b => !!b.querySelector('.btn_update:not(.displayNone)');
    const text = (b, sel) => b.querySelector(sel)?.textContent.trim() ?? '';
    const idx = b => Number(b.dataset.eoIdx ?? 1e9);
    const seen = b => settings().firstSeen[b.dataset.name] ?? 0;

    const byText = (get, dir) => (a, b) => {
        const x = get(a).toLowerCase(), y = get(b).toLowerCase();
        if (!x && !y) return 0;
        if (!x) return 1;   // empty values always go last
        if (!y) return -1;
        return dir * x.localeCompare(y);
    };

    const SORTS = {
        'default': () => 0,
        'name-asc': byText(b => text(b, '.extension_name'), 1),
        'name-desc': byText(b => text(b, '.extension_name'), -1),
        'author-asc': byText(b => text(b, '.extension_author'), 1),
        'author-desc': byText(b => text(b, '.extension_author'), -1),
        'newest': (a, b) => seen(b) - seen(a),
        'oldest': (a, b) => seen(a) - seen(b),
        'updates': (a, b) => Number(hasUpdate(b)) - Number(hasUpdate(a)),
        'enabled': (a, b) => Number(isEnabled(b)) - Number(isEnabled(a)),
        'disabled': (a, b) => Number(isEnabled(a)) - Number(isEnabled(b)),
    };

    const FILTERS = {
        'all': () => true,
        'enabled': isEnabled,
        'disabled': b => !isEnabled(b),
        'updates': hasUpdate,
    };

    // ---- sort + filter + hide ----
    function apply(root) {
        const st = settings();
        const q = root.querySelector('.eo-search').value.trim().toLowerCase();
        const blocks = [...root.querySelectorAll('.extension_block')];
        const filterFn = FILTERS[st.filter] ?? FILTERS.all;
        const sortFn = SORTS[st.sort] ?? SORTS.default;

        const groups = new Map();
        for (const b of blocks) {
            if (!groups.has(b.parentElement)) groups.set(b.parentElement, []);
            groups.get(b.parentElement).push(b);
        }

        let shown = 0;
        for (const [container, list] of groups) {
            const builtIn = !isThirdParty(list[0]);

            // sort (only move nodes if the order actually changes)
            const sorted = [...list].sort((a, b) => sortFn(a, b) || idx(a) - idx(b));
            const current = [...container.querySelectorAll(':scope > .extension_block')];
            if (sorted.some((b, i) => b !== current[i])) sorted.forEach(b => container.appendChild(b));

            // filter
            let visible = 0;
            for (const b of list) {
                const hay = [text(b, '.extension_name'), text(b, '.extension_author'),
                    text(b, '.extension_version'), b.dataset.name].join(' ').toLowerCase();
                const ok = !(builtIn && st.hideBuiltIn) && (!q || hay.includes(q)) && filterFn(b);
                b.classList.toggle('eo-hidden', !ok);
                if (ok) visible++;
            }
            if (builtIn) {
                // hide the whole "Built-in Extensions" section (heading included)
                container.classList.toggle('eo-hidden', st.hideBuiltIn || (visible === 0 && list.length > 0));
            } else {
                shown += visible;
            }
            if (builtIn && !st.hideBuiltIn) shown += visible;
        }

        const total = blocks.filter(b => !(st.hideBuiltIn && !isThirdParty(b))).length;
        root.querySelector('.eo-count').textContent = `${shown} / ${total}`;
        const label = root.querySelector('.eo-btn-builtin span');
        label.textContent = st.hideBuiltIn ? 'Built-in: hidden' : 'Built-in: shown';
        root.querySelector('.eo-btn-builtin i').className =
            `fa-solid ${st.hideBuiltIn ? 'fa-eye-slash' : 'fa-eye'}`;
    }

    // ---- working "Update all" / "Update enabled" ----
    async function updateOne(block) {
        const res = await fetch('/api/extensions/update', {
            method: 'POST',
            signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify({ extensionName: block.dataset.name, global: isGlobal(block) }),
        });
        if (!res.ok) throw new Error((await res.text()) || res.statusText);
        return res.json();
    }

    async function runUpdates(root, onlyEnabled) {
        if (root.dataset.eoBusy) return;

        const targets = [...root.querySelectorAll('.extension_block')]
            .filter(b => isThirdParty(b) && (!onlyEnabled || isEnabled(b)));
        if (!targets.length) {
            toastr.info('No extensions to update.');
            return;
        }

        root.dataset.eoBusy = '1';
        const btns = [...root.querySelectorAll('.eo-btn-update-all, .eo-btn-update-enabled')];
        const labels = new Map(btns.map(b => [b, b.querySelector('span').textContent]));
        btns.forEach(b => b.classList.add('disabled'));
        const active = root.querySelector(onlyEnabled ? '.eo-btn-update-enabled' : '.eo-btn-update-all');

        const result = { updated: [], upToDate: 0, failed: [] };
        let done = 0;
        const progress = () => { active.querySelector('span').textContent = `Updating ${done}/${targets.length}…`; };
        progress();

        const queue = [...targets];
        const worker = async () => {
            while (queue.length) {
                const b = queue.shift();
                const name = text(b, '.extension_name') || b.dataset.name;
                b.classList.remove('eo-updated', 'eo-failed');
                b.classList.add('eo-updating');
                try {
                    const data = await updateOne(b);
                    if (data.isUpToDate) {
                        result.upToDate++;
                    } else {
                        result.updated.push(name);
                        b.classList.add('eo-updated');
                        b.querySelector('.btn_update')?.classList.add('displayNone');
                        b.querySelector('.extension_name')?.classList.remove('update_available');
                    }
                } catch (err) {
                    console.error(`[Extension Organizer] Update failed for ${name}`, err);
                    result.failed.push(name);
                    b.classList.add('eo-failed');
                } finally {
                    b.classList.remove('eo-updating');
                    done++;
                    progress();
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

        btns.forEach(b => { b.classList.remove('disabled'); b.querySelector('span').textContent = labels.get(b); });
        delete root.dataset.eoBusy;

        const opts = { escapeHtml: true, timeOut: 8000 };
        if (result.updated.length) {
            root.querySelector('.eo-btn-reload').classList.remove('eo-hidden');
            toastr.success(result.updated.map(n => `• ${n}`).join('\n'),
                `${result.updated.length} updated, ${result.upToDate} already current`, opts);
        } else if (!result.failed.length) {
            toastr.info(`All ${result.upToDate} extensions are already up to date.`, '', opts);
        }
        if (result.failed.length) {
            toastr.error(result.failed.map(n => `• ${n}`).join('\n'),
                `${result.failed.length} failed (see console)`, { ...opts, timeOut: 12000 });
        }
        apply(root);
    }

    // ---- UI injection ----
    function init(root) {
        root.dataset.eo = '1';
        const st = settings();

        // remember original order + first time we saw each extension (for "newest/oldest")
        const blocks = [...root.querySelectorAll('.extension_block')];
        const now = Date.now();
        blocks.forEach((b, i) => {
            b.dataset.eoIdx = i;
            if (b.dataset.name && !(b.dataset.name in st.firstSeen)) st.firstSeen[b.dataset.name] = now;
        });
        save();

        // hide the core toolbar (its update buttons are what's broken)
        const core = root.querySelector('.extensions_toolbar');
        if (core) core.style.display = 'none';

        const bar = document.createElement('div');
        bar.className = 'eo-toolbar';
        bar.innerHTML = `
            <div class="eo-row">
                <input type="search" class="text_pole eo-search" placeholder="Search name, author, version…">
            </div>
            <div class="eo-row">
                <select class="text_pole eo-sort" title="Sort">
                    <option value="default">Sort: default order</option>
                    <option value="name-asc">Name A → Z</option>
                    <option value="name-desc">Name Z → A</option>
                    <option value="author-asc">Author A → Z</option>
                    <option value="author-desc">Author Z → A</option>
                    <option value="newest">Recently added first</option>
                    <option value="oldest">Oldest added first</option>
                    <option value="updates">Updates available first</option>
                    <option value="enabled">Enabled first</option>
                    <option value="disabled">Disabled first</option>
                </select>
                <select class="text_pole eo-filter" title="Filter">
                    <option value="all">Show: all</option>
                    <option value="enabled">Enabled only</option>
                    <option value="disabled">Disabled only</option>
                    <option value="updates">Updates available</option>
                </select>
            </div>
            <div class="eo-row">
                <button class="menu_button menu_button_icon eo-btn-builtin"><i class="fa-solid fa-eye"></i><span></span></button>
                <button class="menu_button menu_button_icon eo-btn-update-enabled"><i class="fa-solid fa-download"></i><span>Update enabled</span></button>
                <button class="menu_button menu_button_icon eo-btn-update-all"><i class="fa-solid fa-cloud-arrow-down"></i><span>Update all</span></button>
                <button class="menu_button menu_button_icon eo-btn-reload eo-hidden"><i class="fa-solid fa-rotate"></i><span>Reload to apply</span></button>
                <span class="eo-count"></span>
            </div>`;
        root.prepend(bar);

        const $ = sel => bar.querySelector(sel);
        $('.eo-sort').value = st.sort in SORTS ? st.sort : 'default';
        $('.eo-filter').value = st.filter in FILTERS ? st.filter : 'all';

        const rerun = () => apply(root);
        $('.eo-search').addEventListener('input', rerun);
        $('.eo-sort').addEventListener('change', e => { st.sort = e.target.value; save(); rerun(); });
        $('.eo-filter').addEventListener('change', e => { st.filter = e.target.value; save(); rerun(); });
        $('.eo-btn-builtin').addEventListener('click', () => { st.hideBuiltIn = !st.hideBuiltIn; save(); rerun(); });
        $('.eo-btn-update-all').addEventListener('click', () => runUpdates(root, false));
        $('.eo-btn-update-enabled').addEventListener('click', () => runUpdates(root, true));
        $('.eo-btn-reload').addEventListener('click', () => location.reload());

        // authors / update badges load asynchronously in core, so re-apply when the list changes
        let timer;
        const mo = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!root.isConnected) return mo.disconnect();
                mo.disconnect();
                apply(root);
                mo.observe(root, { childList: true, characterData: true, subtree: true });
            }, 150);
        });
        apply(root);
        mo.observe(root, { childList: true, characterData: true, subtree: true });
    }

    new MutationObserver(() => {
        const root = document.querySelector('.extensions_info:not([data-eo])');
        if (root) init(root);
    }).observe(document.body, { childList: true, subtree: true });
})();
