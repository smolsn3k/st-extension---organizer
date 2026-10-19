# Extension Organizer for SillyTavern

🇬🇧 English · [🇷🇺 Русский](#русский)

Search, sort, filter and tidy the extension list inside **Manage extensions** (the popup, not the Extensions tab), and fixes the broken **Update all** / **Update enabled** buttons.

## Features

- **Favorites**: a ☆ button on every extension (built-in and third-party) and a **Favorites** tab next to **All** that shows only your starred ones, with a counter. The tab ignores "hide built-in", since you starred them on purpose.
- **Search** by name, author, version or folder name.
- **Sort**: default order, name A→Z / Z→A, author A→Z / Z→A, recently / oldest added, updates available first, favorites first, enabled first, disabled first.
- **Filter**: all, enabled only, disabled only, updates available.
- **Hide Built-in Extensions** with one button (the whole section, heading included).
- **Working update buttons**:
  - *Update enabled* updates every enabled third-party extension.
  - *Update favorites* updates only your starred third-party extensions (built-in ones update with SillyTavern itself).
  - *Update all* updates every third-party extension, enabled or not.
  - Runs 3 at a time with a live counter; rows turn green (updated) or red (failed); a toast summarizes the result.
  - No forced page reload. A **Reload to apply** button appears when something was updated.
- **Languages**: English and Russian. Follows the SillyTavern UI language automatically. The globe button cycles `auto → EN → RU`.
- Your favorites, tab, sort, filter, built-in and language choices are saved.

## Install

1. Copy the `extension-organizer` folder into one of:
   - `data/<your-user>/extensions/` (only for you), or
   - `public/scripts/extensions/third-party/` (all users).
2. Reload SillyTavern. Open **Extensions → Manage extensions**; the toolbar is at the top.

If you host this in a Git repository, you can also install it via **Install extension** with the repository URL.

## Why the core update buttons failed

In the core code, "Update all" and "Update enabled" go through a routine that exits immediately unless some extension's manifest sets `auto_update`, and "Update enabled" only touches extensions with that flag. Most extensions don't set it, so the buttons did nothing. This extension hides the core toolbar and sends the same `/api/extensions/update` request itself for each extension.

## Limitations

- SillyTavern doesn't expose install/update dates. **Recently / oldest added** uses the time this extension *first saw* each extension in the popup. Extensions you already had all share the first-run timestamp; only extensions added afterwards sort accurately.
- Author names and update badges load asynchronously, so author / "updates available" sorting may reorder the list for a moment after the popup opens.
- Extensions that run custom code on update won't run it when updated through this button.
- It works by reading the popup's DOM, so a big UI refactor in SillyTavern could break it. Open an issue with your ST version if that happens.

## Uninstall

Delete the folder (your favorites are stored in your settings, not in the folder). Saved settings live under `extension_organizer` in your settings and are harmless to leave.

---

## Русский

Поиск, сортировка, фильтры и порядок в списке расширений внутри окна **Manage extensions** (всплывающее окно, а не вкладка Extensions). Плюс исправлены нерабочие кнопки **Update all** и **Update enabled**.

### Возможности

- **Избранное**: кнопка ☆ у каждого расширения (встроенного и стороннего) и вкладка **«Избранное»** рядом с **«Все»**, где показаны только отмеченные расширения, со счётчиком. Вкладка игнорирует «скрыть встроенные», ведь вы отметили их намеренно.
- **Поиск** по названию, автору, версии и имени папки.
- **Сортировка**: по умолчанию, название А→Я / Я→А, автор А→Я / Я→А, недавно / давно добавленные, сначала с обновлениями, сначала избранные, сначала включённые, сначала выключенные.
- **Фильтр**: все, только включённые, только выключенные, есть обновления.
- **Скрытие Built-in Extensions** одной кнопкой (весь раздел вместе с заголовком).
- **Рабочие кнопки обновления**:
  - *Обновить включённые* обновляет все включённые сторонние расширения.
  - *Обновить избранные* обновляет только отмеченные сторонние расширения (встроенные обновляются вместе с SillyTavern).
  - *Обновить все* обновляет все сторонние расширения, включённые или нет.
  - Обновление идёт по 3 штуки одновременно, со счётчиком; строки подсвечиваются зелёным (обновлено) или красным (ошибка); итог показывается уведомлением.
  - Страница не перезагружается принудительно. После обновления появляется кнопка **«Перезагрузить для применения»**.
- **Языки**: английский и русский. Язык берётся из настроек интерфейса SillyTavern автоматически. Кнопка с иконкой языка переключает `авто → EN → RU`.
- Избранное, вкладка, сортировка, фильтр, скрытие встроенных и язык сохраняются.

### Установка

1. Скопируйте папку `extension-organizer` в одно из мест:
   - `data/<ваш-пользователь>/extensions/` (только для вас), или
   - `public/scripts/extensions/third-party/` (для всех пользователей).
2. Перезагрузите SillyTavern. Откройте **Extensions → Manage extensions**: панель инструментов находится сверху.

Если выложить расширение в Git-репозиторий, его можно установить через **Install extension** по ссылке на репозиторий.

### Почему не работали встроенные кнопки

В коде SillyTavern «Update all» и «Update enabled» вызывают функцию, которая сразу завершается, если ни у одного расширения в манифесте нет `auto_update`; к тому же «Update enabled» трогает только расширения с этим флагом. У большинства расширений его нет, поэтому кнопки ничего не делали. Это расширение скрывает встроенную панель и само отправляет запрос `/api/extensions/update` для каждого расширения.

### Ограничения

- SillyTavern не отдаёт даты установки и обновления. **«Недавно / давно добавленные»** опирается на момент, когда это расширение *впервые увидело* расширение в окне. У тех, что были у вас раньше, время одинаковое (первый запуск); точно сортируются только добавленные позже.
- Авторы и значки обновлений подгружаются асинхронно, поэтому сортировка по автору или по наличию обновлений может на мгновение переставить список после открытия окна.
- Расширения с собственным кодом на событие обновления не выполнят его при обновлении через эту кнопку.
- Расширение читает DOM окна, поэтому крупная переработка интерфейса SillyTavern может его сломать. В таком случае сообщите версию ST.

### Удаление

Удалите папку. Сохранённые настройки лежат в `extension_organizer` внутри ваших настроек и никому не мешают.
