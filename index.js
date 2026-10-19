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
        s.language ??= 'auto';
        s.tab ??= 'all';
        s.favorites ??= {};
        s.firstSeen ??= {};
        return s;
    }
    const save = () => ctx().saveSettingsDebounced();

    // ---- i18n (auto-detects SillyTavern UI language; can be forced via the globe button) ----
    const I18N = {
        en: {
            searchPh: 'Search name, author, version…',
            s_default: 'Sort: default order',
            s_name_asc: 'Name A → Z', s_name_desc: 'Name Z → A',
            s_author_asc: 'Author A → Z', s_author_desc: 'Author Z → A',
            s_newest: 'Recently added first', s_oldest: 'Oldest added first',
            s_updates: 'Updates available first',
            s_enabled: 'Enabled first', s_disabled: 'Disabled first',
            f_all: 'Show: all', f_enabled: 'Enabled only', f_disabled: 'Disabled only', f_updates: 'Updates available',
            builtinShown: 'Built-in: shown', builtinHidden: 'Built-in: hidden',
            updateEnabled: 'Update enabled', updateAll: 'Update all', reload: 'Reload to apply',
            updating: 'Updating {0}/{1}…',
            noTargets: 'No extensions to update.',
            updatedTitle: '{0} updated, {1} already current',
            allCurrent: 'All {0} extensions are already up to date.',
            failedTitle: '{0} failed (see console)',
            auto: 'auto',
            tabAll: 'All', tabFav: 'Favorites',
            s_favorites: 'Favorites first',
            noFavs: 'No favorites yet. Tap the ☆ next to an extension to add it.',
            starAdd: 'Add to favorites', starRemove: 'Remove from favorites',
            langTitle: 'Language: {0} (click to switch: auto / EN / RU)',
        },
        ru: {
            searchPh: 'Поиск: название, автор, версия…',
            s_default: 'Сортировка: по умолчанию',
            s_name_asc: 'Название А → Я', s_name_desc: 'Название Я → А',
            s_author_asc: 'Автор А → Я', s_author_desc: 'Автор Я → А',
            s_newest: 'Сначала недавно добавленные', s_oldest: 'Сначала давно добавленные',
            s_updates: 'Сначала с обновлениями',
            s_enabled: 'Сначала включённые', s_disabled: 'Сначала выключенные',
            f_all: 'Показать: все', f_enabled: 'Только включённые', f_disabled: 'Только выключенные', f_updates: 'Есть обновления',
            builtinShown: 'Встроенные: показаны', builtinHidden: 'Встроенные: скрыты',
            updateEnabled: 'Обновить включённые', updateAll: 'Обновить все', reload: 'Перезагрузить для применения',
            updating: 'Обновление {0}/{1}…',
            noTargets: 'Нет расширений для обновления.',
            updatedTitle: 'Обновлено: {0}, уже актуальны: {1}',
            allCurrent: 'Все расширения ({0}) уже актуальны.',
            failedTitle: 'Ошибок: {0} (см. консоль)',
            auto: 'авто',
            tabAll: 'Все', tabFav: 'Избранное',
            s_favorites: 'Сначала избранные',
            noFavs: 'Избранного пока нет. Нажмите ☆ рядом с расширением, чтобы добавить.',
            starAdd: 'В избранное', starRemove: 'Убрать из избранного',
            langTitle: 'Язык: {0} (нажмите для смены: авто / EN / RU)',
        },
    };

    function currentLang() {
        const pref = settings().language;
        if (pref === 'en' || pref === 'ru') return pref;
        let loc = '';
        try { loc = ctx().getCurrentLocale?.() ?? ''; } catch { /* ignore */ }
        loc ||= localStorage.getItem('language') || navigator.language || '';
        return String(loc).toLowerCase().startsWith('ru') ? 'ru' : 'en';
    }

    function t(key, ...args) {
        const str = I18N[currentLang()][key] ?? I18N.en[key] ?? key;
        return str.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '');
    }

    // ---- block helpers (read straight from the core DOM) ----
    const toggleOf = b => b.querySelector('.extension_toggle input');
    const isThirdParty = b => (toggleOf(b)?.dataset.name ?? '').startsWith('third-party');
    const isEnabled = b => !!toggleOf(b)?.checked;
    const isGlobal = b => !!b.querySelector('.extension_icon .fa-server');
    const hasUpdate = b => !!b.querySelector('.btn_update:not(.displayNone)');
    const text = (b, sel) => b.querySelector(sel)?.textContent.trim() ?? '';
    const idx = b => Number(b.dataset.eoIdx ?? 1e9);
    const seen = b => settings().firstSeen[b.dataset.name] ?? 0;
    const isFav = b => !!settings().favorites[b.dataset.name];

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
        'favorites': (a, b) => Number(isFav(b)) - Number(isFav(a)),
        'enabled': (a, b) => Number(isEnabled(b)) - Number(isEnabled(a)),
        'disabled': (a, b) => Number(isEnabled(a)) - Number(isEnabled(b)),
    };

    const FILTERS = {
        'all': () => true,
        'enabled': isEnabled,
        'disabled': b => !isEnabled(b),
        'updates': hasUpdate,
    };

    // ---- sort + filter + tabs + hide ----
    function refreshStar(b) {
        const star = b.querySelector('.eo-star');
        if (!star) return;
        const fav = isFav(b);
        star.classList.toggle('eo-fav', fav);
        star.querySelector('i').className = `fa-star fa-fw ${fav ? 'fa-solid' : 'fa-regular'}`;
        star.title = t(fav ? 'starRemove' : 'starAdd');
    }

    function apply(root) {
        const st = settings();
        const favTab = st.tab === 'favorites';
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

            // filter: favorites tab ignores "hide built-in" (you starred it on purpose)
            let visible = 0;
            for (const b of list) {
                const hay = [text(b, '.extension_name'), text(b, '.extension_author'),
                    text(b, '.extension_version'), b.dataset.name].join(' ').toLowerCase();
                const hiddenBuiltIn = builtIn && st.hideBuiltIn && !favTab;
                const ok = !hiddenBuiltIn && (!favTab || isFav(b)) && (!q || hay.includes(q)) && filterFn(b);
                b.classList.toggle('eo-hidden', !ok);
                if (ok) visible++;
                refreshStar(b);
            }
            // built-in section (heading included) disappears when it has nothing to show
            if (builtIn) container.classList.toggle('eo-hidden', visible === 0);
            shown += visible;
        }

        const favCount = blocks.filter(isFav).length;
        const total = blocks.filter(b => favTab ? isFav(b) : !(st.hideBuiltIn && !isThirdParty(b))).length;

        const bar = root.querySelector('.eo-toolbar');
        bar.classList.toggle('eo-favtab', favTab);
        bar.querySelectorAll('.eo-tab').forEach(x => x.classList.toggle('eo-active', x.dataset.tab === st.tab));
        bar.querySelector('.eo-fav-count').textContent = favCount ? `(${favCount})` : '';
        const empty = bar.querySelector('.eo-empty');
        empty.textContent = t('noFavs');
        empty.classList.toggle('eo-hidden', !(favTab && favCount === 0));

        bar.querySelector('.eo-count').textContent = `${shown} / ${total}`;
        bar.querySelector('.eo-btn-builtin span').textContent = st.hideBuiltIn ? t('builtinHidden') : t('builtinShown');
        bar.querySelector('.eo-btn-builtin i').className = `fa-solid ${st.hideBuiltIn ? 'fa-eye-slash' : 'fa-eye'}`;
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
            toastr.info(t('noTargets'));
            return;
        }

        root.dataset.eoBusy = '1';
        const btns = [...root.querySelectorAll('.eo-btn-update-all, .eo-btn-update-enabled')];
        const labels = new Map(btns.map(b => [b, b.querySelector('span').textContent]));
        btns.forEach(b => b.classList.add('disabled'));
        const active = root.querySelector(onlyEnabled ? '.eo-btn-update-enabled' : '.eo-btn-update-all');

        const result = { updated: [], upToDate: 0, failed: [] };
        let done = 0;
        const progress = () => { active.querySelector('span').textContent = t('updating', done, targets.length); };
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
                t('updatedTitle', result.updated.length, result.upToDate), opts);
        } else if (!result.failed.length) {
            toastr.info(t('allCurrent', result.upToDate), '', opts);
        }
        if (result.failed.length) {
            toastr.error(result.failed.map(n => `• ${n}`).join('\n'),
                t('failedTitle', result.failed.length), { ...opts, timeOut: 12000 });
        }
        apply(root);
    }

    // ---- UI injection ----
    function translateBar(bar) {
        bar.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
        bar.querySelector('.eo-search').placeholder = t('searchPh');
        const lang = settings().language;
        const btn = bar.querySelector('.eo-btn-lang');
        const shown = lang === 'auto' ? t('auto') : lang.toUpperCase();
        btn.querySelector('span').textContent = shown;
        btn.title = t('langTitle', shown);
    }

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

        // star button on every block (core re-creates blocks each time the popup opens)
        for (const b of blocks) {
            const star = document.createElement('button');
            star.className = 'menu_button eo-star';
            star.innerHTML = '<i class="fa-star fa-fw fa-regular"></i>';
            (b.querySelector('.extension_actions') ?? b).prepend(star);
        }
        root.addEventListener('click', e => {
            const star = e.target.closest('.eo-star');
            if (!star) return;
            const b = star.closest('.extension_block');
            if (!b?.dataset.name) return;
            if (st.favorites[b.dataset.name]) delete st.favorites[b.dataset.name];
            else st.favorites[b.dataset.name] = true;
            save();
            apply(root);
        });

        // hide the core toolbar (its update buttons are what's broken)
        const core = root.querySelector('.extensions_toolbar');
        if (core) core.style.display = 'none';

        const bar = document.createElement('div');
        bar.className = 'eo-toolbar';
        bar.innerHTML = `
            <div class="eo-row eo-tabs">
                <button class="menu_button eo-tab" data-tab="all"><span data-i18n="tabAll"></span></button>
                <button class="menu_button eo-tab" data-tab="favorites"><i class="fa-solid fa-star"></i><span data-i18n="tabFav"></span><span class="eo-fav-count"></span></button>
            </div>
            <div class="eo-empty eo-hidden"></div>
            <div class="eo-row">
                <input type="search" class="text_pole eo-search">
            </div>
            <div class="eo-row">
                <select class="text_pole eo-sort" >
                    <option value="default" data-i18n="s_default"></option>
                    <option value="name-asc" data-i18n="s_name_asc"></option>
                    <option value="name-desc" data-i18n="s_name_desc"></option>
                    <option value="author-asc" data-i18n="s_author_asc"></option>
                    <option value="author-desc" data-i18n="s_author_desc"></option>
                    <option value="newest" data-i18n="s_newest"></option>
                    <option value="oldest" data-i18n="s_oldest"></option>
                    <option value="updates" data-i18n="s_updates"></option>
                    <option value="favorites" data-i18n="s_favorites"></option>
                    <option value="enabled" data-i18n="s_enabled"></option>
                    <option value="disabled" data-i18n="s_disabled"></option>
                </select>
                <select class="text_pole eo-filter" >
                    <option value="all" data-i18n="f_all"></option>
                    <option value="enabled" data-i18n="f_enabled"></option>
                    <option value="disabled" data-i18n="f_disabled"></option>
                    <option value="updates" data-i18n="f_updates"></option>
                </select>
            </div>
            <div class="eo-row">
                <button class="menu_button menu_button_icon eo-btn-builtin"><i class="fa-solid fa-eye"></i><span></span></button>
                <button class="menu_button menu_button_icon eo-btn-update-enabled"><i class="fa-solid fa-download"></i><span data-i18n="updateEnabled"></span></button>
                <button class="menu_button menu_button_icon eo-btn-update-all"><i class="fa-solid fa-cloud-arrow-down"></i><span data-i18n="updateAll"></span></button>
                <button class="menu_button menu_button_icon eo-btn-reload eo-hidden"><i class="fa-solid fa-rotate"></i><span data-i18n="reload"></span></button>
                <button class="menu_button menu_button_icon eo-btn-lang"><i class="fa-solid fa-language"></i><span></span></button>
                <span class="eo-count"></span>
            </div>`;
        root.prepend(bar);

        const $ = sel => bar.querySelector(sel);
        translateBar(bar);
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
        bar.querySelectorAll('.eo-tab').forEach(tab => tab.addEventListener('click', () => {
            st.tab = tab.dataset.tab;
            save();
            rerun();
        }));
        $('.eo-btn-lang').addEventListener('click', () => {
            const order = ['auto', 'en', 'ru'];
            st.language = order[(order.indexOf(st.language) + 1) % order.length];
            save();
            translateBar(bar);
            rerun();
        });

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
