// Extension Panel Manager

import { eventSource, event_types } from '../../../../script.js';

const STORAGE_KEY = 'ext_panel_manager_state';

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ===== Получение управляемых объектов =====
let autoIdSeq = 0;

function getManagedItems() {
    const col1 = document.getElementById('extensions_settings');
    const col2 = document.getElementById('extensions_settings2');
    const items = [];
    [col1, col2].forEach(col => {
        if (!col) return;
        Array.from(col.children).forEach(el => {
            if (!el.querySelector('.inline-drawer-header')) return;
            if (!el.id) el.id = 'ext-panel-auto-' + (autoIdSeq++);
            items.push(el);
        });
    });
    return items;
}

function getTopHeader(container) {
    return container.querySelector('.inline-drawer-header');
}

// Получить отображаемое имя заголовка
function getHeaderName(header) {
    return header?.querySelector('b, span[data-i18n]')?.textContent?.trim() || '';
}

function isInRightCol(container) {
    return container.parentElement?.id === 'extensions_settings2';
}

// ===== Применение сохранённого состояния (загрузка страницы) =====
function applyStoredState() {
    const stored = loadState();
    const col1 = document.getElementById('extensions_settings');
    const col2 = document.getElementById('extensions_settings2');
    if (!col1 || !col2) return;

        getManagedItems(); // Убедиться, что существующие элементы уже получили ID

    const hiddenSet = new Set(stored.hidden || []);

    function applyHiddenIfNeeded(el) {
        if (el.id && hiddenSet.has(el.id) && !el.classList.contains('ext-panel-hidden')) {
            el.classList.add('ext-panel-hidden');
            el.style.display = 'none';
        }
    }

    getManagedItems().forEach(applyHiddenIfNeeded);

    if (stored.order?.length) {
        stored.order.forEach(({ id, col }) => {
            const el = document.getElementById(id);
            if (!el) return;
            (col === 2 ? col2 : col1).appendChild(el);
        });
    }

    // Отслеживать асинхронно загруженные панели и применять к ним скрытие
    const lateObserver = new MutationObserver(() => {
        getManagedItems().forEach(applyHiddenIfNeeded);
    });
    lateObserver.observe(col1, { childList: true });
    lateObserver.observe(col2, { childList: true });
    setTimeout(() => lateObserver.disconnect(), 15000);
}

// ===== Режим редактирования =====
let isEditing = false;
let snapshot = null;
const blockedHeaders = new Map();

// Состояние перетаскивания
let dragSrc = null;
const headerDragHandlers = new Map();
const colDragHandlers = new Map();

function blockHeaderClick(e) {
    if (!e.target.closest('.ext-panel-checkbox')) {
        e.stopPropagation();
        e.preventDefault();
    }
}

function takeSnapshot() {
    const hidden = new Set();
    const order = [];
    getManagedItems().forEach(el => {
        if (!el.id) return;
        if (el.classList.contains('ext-panel-hidden')) hidden.add(el.id);
        order.push({ id: el.id, col: isInRightCol(el) ? 2 : 1 });
    });
    return { hidden, order };
}

function collapseAllDrawers() {
    document.querySelectorAll('#extensions_settings .inline-drawer-content, #extensions_settings2 .inline-drawer-content').forEach(content => {
        if (content.style.display === 'none') return;
        content.style.display = 'none';
        const icon = content.previousElementSibling?.querySelector('.inline-drawer-icon');
        if (icon) {
            icon.classList.remove('up', 'fa-circle-chevron-up');
            icon.classList.add('down', 'fa-circle-chevron-down');
        }
    });
}

function enterEditMode() {
    if (isEditing) return;
    isEditing = true;
    snapshot = takeSnapshot();

    collapseAllDrawers();
    document.getElementById('rm_extensions_block')?.classList.add('ext-panel-editing');

    getManagedItems().forEach(container => {
        if (!container.id) return;

        // Показать скрытые контейнеры (полупрозрачными)
        if (container.classList.contains('ext-panel-hidden')) {
            container.style.display = '';
            container.style.opacity = '0.4';
        }

        const header = getTopHeader(container);
        if (!header || header.querySelector('.ext-panel-checkbox')) return;

        // Перехватить нативный клик (раскрыть/свернуть)
        header.addEventListener('click', blockHeaderClick, true);
        blockedHeaders.set(header, blockHeaderClick);

        // 勾選框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ext-panel-checkbox';
        checkbox.checked = !container.classList.contains('ext-panel-hidden');
        checkbox.title = 'Показать эту панель';
        checkbox.onclick = e => e.stopPropagation();
        checkbox.onchange = () => {
            if (checkbox.checked) {
                container.classList.remove('ext-panel-hidden');
                container.style.opacity = '';
            } else {
                container.classList.add('ext-panel-hidden');
                container.style.opacity = '0.4';
            }
            updateFloatingCount();
        };
        header.insertBefore(checkbox, header.firstChild);

        // Дочерние drawer: перехватить клики + добавить подсказку после заголовка
        const parentName = getHeaderName(header);
        container.querySelectorAll('.inline-drawer-header').forEach(subHeader => {
            if (subHeader === header) return;

            // Перехватить раскрытие/сворачивание дочерних drawer
            subHeader.addEventListener('click', blockHeaderClick, true);
            blockedHeaders.set(subHeader, blockHeaderClick);

            if (subHeader.querySelector('.ext-panel-sub-note')) return;
            const titleEl = subHeader.querySelector('b, span[data-i18n]');
            const noteText = parentName
                ? `(этот элемент следует за ${parentName} — показать/скрыть)`
                : '(следует за родительским контейнером — показать/скрыть)';
            const note = document.createElement('span');
            note.className = 'ext-panel-sub-note';
            note.textContent = noteText;
            if (titleEl) {
                titleEl.insertAdjacentElement('afterend', note);
            } else {
                subHeader.appendChild(note);
            }
        });

    });

    // Перетаскивание: применить ко всем прямым дочерним элементам обоих столбцов (включая пустые контейнеры)
    const cols = [document.getElementById('extensions_settings'), document.getElementById('extensions_settings2')];
    cols.forEach(col => {
        if (!col) return;
        Array.from(col.children).forEach(el => setupDrag(el));
        setupColDrop(col);
    });

    // Плавающая панель подтверждения
    const wrapper = document.createElement('div');
    wrapper.id = 'ext-panel-float-wrapper';
    wrapper.innerHTML = `
        <div id="ext-panel-float-panel">
            <span id="ext-panel-float-count"></span>
            <div id="ext-panel-float-finish" class="menu_button menu_button_icon" title="Применить">
                <i class="fa-solid fa-check"></i>
            </div>
            <div id="ext-panel-float-cancel" class="menu_button menu_button_icon" title="Отмена">
                <i class="fa-solid fa-xmark"></i>
            </div>
        </div>`;
    (document.getElementById('rm_extensions_block') || document.body).appendChild(wrapper);
    wrapper.querySelector('#ext-panel-float-finish').onclick = confirmEditMode;
    wrapper.querySelector('#ext-panel-float-cancel').onclick = cancelEditMode;

    updateFloatingCount();
    updateManageBtn(true);
}

// ===== Логика перетаскивания =====
function setupDrag(container) {
    container.draggable = true;

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragend', onDragEnd);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);

    // Если у container есть header — сделать header тоже перетаскиваемым и передавать события контейнеру
    // Чтобы input/button внутри header не перехватывали mousedown и не блокировали перетаскивание контейнера
    const header = getTopHeader(container);
    if (header) {
        const onHeaderDragStart = (e) => {
            e.stopPropagation();
            dragSrc = container;
            container.classList.add('ext-panel-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', container.id);
        };
        const onHeaderDragEnd = (e) => {
            e.stopPropagation();
            container.classList.remove('ext-panel-dragging');
            document.querySelectorAll('.ext-panel-drag-over').forEach(el => el.classList.remove('ext-panel-drag-over'));
            dragSrc = null;
        };
        header.draggable = true;
        header.addEventListener('dragstart', onHeaderDragStart);
        header.addEventListener('dragend', onHeaderDragEnd);
        headerDragHandlers.set(header, { onHeaderDragStart, onHeaderDragEnd });
    }
}

function teardownDrag(container) {
    container.draggable = false;
    container.removeEventListener('dragstart', onDragStart);
    container.removeEventListener('dragend', onDragEnd);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('dragleave', onDragLeave);
    container.removeEventListener('drop', onDrop);
    container.classList.remove('ext-panel-drag-over');

    const header = getTopHeader(container);
    if (header) {
        const handlers = headerDragHandlers.get(header);
        if (handlers) {
            header.draggable = false;
            header.removeEventListener('dragstart', handlers.onHeaderDragStart);
            header.removeEventListener('dragend', handlers.onHeaderDragEnd);
            headerDragHandlers.delete(header);
        }
    }
}

function setupColDrop(col) {
    const onDragOver = (e) => {
        if (!dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('ext-panel-col-drag-over');
    };
    const onDragLeave = (e) => {
        if (!col.contains(e.relatedTarget)) {
            col.classList.remove('ext-panel-col-drag-over');
        }
    };
    const onDrop = (e) => {
        e.preventDefault();
        col.classList.remove('ext-panel-col-drag-over');
        if (!dragSrc) return;
        col.appendChild(dragSrc);
    };
    col.addEventListener('dragover', onDragOver);
    col.addEventListener('dragleave', onDragLeave);
    col.addEventListener('drop', onDrop);
    colDragHandlers.set(col, { onDragOver, onDragLeave, onDrop });
}

function teardownColDrop(col) {
    const handlers = colDragHandlers.get(col);
    if (!handlers) return;
    col.removeEventListener('dragover', handlers.onDragOver);
    col.removeEventListener('dragleave', handlers.onDragLeave);
    col.removeEventListener('drop', handlers.onDrop);
    col.classList.remove('ext-panel-col-drag-over');
    colDragHandlers.delete(col);
}

function onDragStart(e) {
    dragSrc = this;
    this.classList.add('ext-panel-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.id);
}

function onDragEnd() {
    this.classList.remove('ext-panel-dragging');
    document.querySelectorAll('.ext-panel-drag-over').forEach(el => el.classList.remove('ext-panel-drag-over'));
    dragSrc = null;
}

function onDragOver(e) {
    if (!dragSrc || dragSrc === this) return;
    e.preventDefault();
    e.stopPropagation(); // Избежать срабатывания dragover на уровне столбца
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('ext-panel-drag-over');
}

function onDragLeave(e) {
    if (!this.contains(e.relatedTarget)) {
        this.classList.remove('ext-panel-drag-over');
    }
}

function onDrop(e) {
    e.preventDefault();
    e.stopPropagation(); // Избежать срабатывания drop на уровне столбца
    if (!dragSrc || dragSrc === this) return;
    this.classList.remove('ext-panel-drag-over');

    const parent = this.parentElement;
    const allChildren = Array.from(parent.children);
    const srcIdx = allChildren.indexOf(dragSrc);
    const tgtIdx = allChildren.indexOf(this);

    if (srcIdx < tgtIdx) {
        parent.insertBefore(dragSrc, this.nextSibling);
    } else {
        parent.insertBefore(dragSrc, this);
    }
}

function updateFloatingCount() {
    const el = document.getElementById('ext-panel-float-count');
    if (!el) return;
    const all = getManagedItems();
    const visible = all.filter(c => !c.classList.contains('ext-panel-hidden')).length;
    el.textContent = `Показано ${visible} / ${all.length}`;
}

function confirmEditMode() {
    if (!isEditing) return;
    isEditing = false;

    const newState = { hidden: [], order: [] };

    getManagedItems().forEach(container => {
        if (!container.id) return;
        container.style.opacity = '';
        if (container.classList.contains('ext-panel-hidden')) {
            container.style.display = 'none';
            newState.hidden.push(container.id);
        } else {
            container.style.display = '';
        }
        newState.order.push({ id: container.id, col: isInRightCol(container) ? 2 : 1 });
    });

    saveState(newState);
    snapshot = null;
    cleanupEditUI();
    updateManageBtn(false);
    toastr?.success('Настройки панелей сохранены');
}

function cancelEditMode() {
    if (!isEditing) return;
    isEditing = false;

    cleanupEditUI();

    if (snapshot) {
        const col1 = document.getElementById('extensions_settings');
        const col2 = document.getElementById('extensions_settings2');

        snapshot.order.forEach(({ id, col }) => {
            const el = document.getElementById(id);
            if (!el) return;
            (col === 2 ? col2 : col1).appendChild(el);
        });

        getManagedItems().forEach(container => {
            if (!container.id) return;
            container.style.opacity = '';
            if (snapshot.hidden.has(container.id)) {
                container.classList.add('ext-panel-hidden');
                container.style.display = 'none';
            } else {
                container.classList.remove('ext-panel-hidden');
                container.style.display = '';
            }
        });

        snapshot = null;
    }

    updateManageBtn(false);
    toastr?.info('Отменено, восстановлено до изменений');
}

function cleanupEditUI() {
    document.getElementById('rm_extensions_block')?.classList.remove('ext-panel-editing');

    blockedHeaders.forEach((listener, header) => {
        header.removeEventListener('click', listener, true);
    });
    blockedHeaders.clear();

    // Убрать перетаскивание (все прямые дочерние элементы)
    const cols = [document.getElementById('extensions_settings'), document.getElementById('extensions_settings2')];
    cols.forEach(col => {
        if (!col) return;
        Array.from(col.children).forEach(el => teardownDrag(el));
        teardownColDrop(col);
    });

    document.querySelectorAll('.ext-panel-checkbox').forEach(el => el.remove());
    document.querySelectorAll('.ext-panel-sub-note').forEach(el => el.remove());
    document.getElementById('ext-panel-float-wrapper')?.remove();

    getManagedItems().forEach(container => {
        if (container.classList.contains('ext-panel-hidden')) {
            container.style.display = 'none';
            container.style.opacity = '';
        }
    });
}

function updateManageBtn(active) {
    document.getElementById('ext-panel-manage-btn')?.classList.toggle('active', active);
}

// ===== Кнопка управления =====
function createManageButton() {
    if (document.getElementById('ext-panel-manage-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'ext-panel-manage-btn';
    btn.className = 'menu_button menu_button_icon interactable';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.title = 'Управление панелями расширений';
    btn.innerHTML = '<i class="fa-solid fa-table-columns"></i><span>Панели</span>';
    btn.onclick = () => isEditing ? cancelEditMode() : enterEditMode();
    document.getElementById('third_party_extension_button')?.insertAdjacentElement('afterend', btn);
}

// ===== Инициализация =====
function initialize() {
    createManageButton();
    applyStoredState();
}

if (document.getElementById('extensions_settings') && document.getElementById('third_party_extension_button')) {
    initialize();
} else {
    const observer = new MutationObserver(() => {
        if (document.getElementById('extensions_settings') && document.getElementById('third_party_extension_button')) {
            observer.disconnect();
            initialize();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
