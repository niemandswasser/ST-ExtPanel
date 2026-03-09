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

// ===== 取得管理對象 =====
// 「管理項目」= 兩欄直接子元素中，含有 inline-drawer-header 的那些
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

// 取得容器的頂層 header
function getTopHeader(container) {
    return container.querySelector('.inline-drawer-header');
}

function isInRightCol(container) {
    return container.parentElement?.id === 'extensions_settings2';
}

// ===== 套用儲存狀態（頁面載入）=====
function applyStoredState() {
    const stored = loadState();
    const col1 = document.getElementById('extensions_settings');
    const col2 = document.getElementById('extensions_settings2');
    if (!col1 || !col2) return;

    if (stored.hidden?.length) {
        stored.hidden.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.add('ext-panel-hidden'); el.style.display = 'none'; }
        });
    }

    if (stored.order?.length) {
        stored.order.forEach(({ id, col }) => {
            const el = document.getElementById(id);
            if (!el) return;
            (col === 2 ? col2 : col1).appendChild(el);
        });
    }
}

// ===== 編輯模式 =====
let isEditing = false;
let snapshot = null;
const blockedHeaders = new Map(); // header -> listener

function blockHeaderClick(e) {
    if (!e.target.closest('.ext-panel-checkbox, .ext-panel-move-btn')) {
        e.stopPropagation();
        e.preventDefault();
    }
}

function takeSnapshot() {
    const col2 = document.getElementById('extensions_settings2');
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

        // 顯示隱藏中的容器（半透明）
        if (container.classList.contains('ext-panel-hidden')) {
            container.style.display = '';
            container.style.opacity = '0.4';
        }

        const header = getTopHeader(container);
        if (!header || header.querySelector('.ext-panel-checkbox')) return;

        // 攔截原生點擊（展開/收合）
        header.addEventListener('click', blockHeaderClick, true);
        blockedHeaders.set(header, blockHeaderClick);

        // 勾選框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ext-panel-checkbox';
        checkbox.checked = !container.classList.contains('ext-panel-hidden');
        checkbox.title = '顯示此面板';
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

        // 移動按鈕（依目前所在欄位）
        attachMoveBtn(container, header);
    });

    // 浮動確認面板
    const wrapper = document.createElement('div');
    wrapper.id = 'ext-panel-float-wrapper';
    wrapper.innerHTML = `
        <div id="ext-panel-float-panel">
            <span id="ext-panel-float-count"></span>
            <div id="ext-panel-float-finish" class="menu_button menu_button_icon" title="確認">
                <i class="fa-solid fa-check"></i>
            </div>
            <div id="ext-panel-float-cancel" class="menu_button menu_button_icon" title="取消">
                <i class="fa-solid fa-xmark"></i>
            </div>
        </div>`;
    (document.getElementById('rm_extensions_block') || document.body).appendChild(wrapper);
    wrapper.querySelector('#ext-panel-float-finish').onclick = confirmEditMode;
    wrapper.querySelector('#ext-panel-float-cancel').onclick = cancelEditMode;

    updateFloatingCount();
    updateManageBtn(true);
}

// 依容器目前所在欄位加上對應方向鍵
function attachMoveBtn(container, header) {
    header.querySelectorAll('.ext-panel-move-btn').forEach(el => el.remove());

    const col1 = document.getElementById('extensions_settings');
    const col2 = document.getElementById('extensions_settings2');

    if (isInRightCol(container)) {
        // 在右欄 → 加 ◀
        const btn = makeMoveBtn('◀', '移到左欄', () => {
            col1.appendChild(container);
            attachMoveBtn(container, header);
        });
        header.appendChild(btn);
    } else {
        // 在左欄 → 加 ▶
        const btn = makeMoveBtn('▶', '移到右欄', () => {
            col2.appendChild(container);
            attachMoveBtn(container, header);
        });
        header.appendChild(btn);
    }
}

function makeMoveBtn(text, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'ext-panel-move-btn';
    btn.textContent = text;
    btn.title = title;
    btn.onclick = e => { e.stopPropagation(); onClick(); };
    return btn;
}

function updateFloatingCount() {
    const el = document.getElementById('ext-panel-float-count');
    if (!el) return;
    const all = getManagedItems();
    const visible = all.filter(c => !c.classList.contains('ext-panel-hidden')).length;
    el.textContent = `顯示 ${visible} / ${all.length}`;
}

function confirmEditMode() {
    if (!isEditing) return;
    isEditing = false;

    const col2 = document.getElementById('extensions_settings2');
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
    toastr?.success('面板設定已儲存');
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
    toastr?.info('已取消，還原至修改前');
}

function cleanupEditUI() {
    document.getElementById('rm_extensions_block')?.classList.remove('ext-panel-editing');

    // 解除事件攔截
    blockedHeaders.forEach((listener, header) => {
        header.removeEventListener('click', listener, true);
    });
    blockedHeaders.clear();

    document.querySelectorAll('.ext-panel-checkbox').forEach(el => el.remove());
    document.querySelectorAll('.ext-panel-move-btn').forEach(el => el.remove());
    document.getElementById('ext-panel-float-wrapper')?.remove();

    // 隱藏中的容器回到不可見
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

// ===== 管理按鈕 =====
function createManageButton() {
    if (document.getElementById('ext-panel-manage-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'ext-panel-manage-btn';
    btn.className = 'menu_button menu_button_icon interactable';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.title = '管理擴充功能面板';
    btn.innerHTML = '<i class="fa-solid fa-table-columns"></i><span>管理面板</span>';
    btn.onclick = () => isEditing ? cancelEditMode() : enterEditMode();
    document.getElementById('third_party_extension_button')?.insertAdjacentElement('afterend', btn);
}

// ===== 初始化 =====
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
