import { escapeHTML, formatTime, generateUUID } from './utils.js';
import { getUsername, getSession, clearSession, getUUID } from './auth.js';
import { wsClient } from './websocket.js';
import { newDirectChat, newGroupChat, searchUser } from './api.js';

let elements = {};

export function initUI() {
    elements = {
        loginPage: document.getElementById('loginPage'),
        chatPage: document.getElementById('chatPage'),
        chatList: document.getElementById('chatList'),
        messageContainer: document.getElementById('messageContainer'),
        messageInput: document.getElementById('messageInput'),
        sendButton: document.getElementById('sendButton'),
        chatWelcome: document.getElementById('chatWelcome'),
        chatWindow: document.getElementById('chatWindow'),
        loginForm: document.getElementById('loginForm'),
        signupForm: document.getElementById('signupForm'),
        loginError: document.getElementById('loginError'),
        signupError: document.getElementById('signupError'),
        showSignup: document.getElementById('showSignup'),
        showLogin: document.getElementById('showLogin'),
        logoutBtn: document.getElementById('logoutBtn'),
        userStatus: document.getElementById('userStatus'),
        newChatBtn: document.getElementById('newChatBtn'),
        searchInput: document.getElementById('searchInput'),
        searchBtn: document.getElementById('searchBtn'),
    };
}

export function showLoginPage() {
    elements.loginPage.classList.add('active');
    elements.loginPage.style.display = 'flex';
    elements.chatPage.style.display = 'none';
}

export function showChatPage() {
    elements.loginPage.classList.remove('active');
    elements.loginPage.style.display = 'none';
    elements.chatPage.style.display = 'flex';
    elements.chatPage.style.flexDirection = 'column';
    const username = getUsername();
    if (username) {
        elements.userStatus.textContent = `👤 ${username}`;
    }
}

// --- Рендер чатов ---
export function renderChats(chats) {
    if (!elements.chatList) return;
    if (!chats || chats.length === 0) {
        elements.chatList.innerHTML = `<div class="empty-state"><p>Нет чатов</p></div>`;
        return;
    }
    let html = '';
    chats.forEach(chat => {
        const lastMsg = chat.lastMessage ? escapeHTML(chat.lastMessage) : 'Нет сообщений';
        const time = chat.lastMessageTimeSent ? formatTime(chat.lastMessageTimeSent) : '';
        const avatarLetter = (chat.name || '?')[0].toUpperCase();
        html += `
            <div class="chat-item" data-uuid="${chat.UUID}">
                <div class="chat-avatar">${avatarLetter}</div>
                <div class="chat-info">
                    <div class="chat-name">${escapeHTML(chat.name || 'Без названия')}</div>
                    <div class="chat-last">${lastMsg}</div>
                </div>
                <div class="chat-time">${time}</div>
            </div>
        `;
    });
    elements.chatList.innerHTML = html;
    elements.chatList.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', () => {
            const uuid = el.dataset.uuid;
            selectChat(uuid);
        });
    });
}

// --- Выбор чата ---
let currentChatUUID = null;
let messages = [];
let isLoadingMore = false;

export function selectChat(chatUUID) {
    currentChatUUID = chatUUID;
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.uuid === chatUUID);
    });
    elements.chatWelcome.style.display = 'none';
    elements.chatWindow.style.display = 'flex';
    elements.messageContainer.innerHTML = '<div class="loading">Загрузка сообщений...</div>';
    wsClient.openChat(chatUUID);
}

// --- Рендер сообщений ---
export function renderMessages(msgs, append = false) {
    if (!append) {
        messages = msgs || [];
        elements.messageContainer.innerHTML = '';
    } else {
        messages = [...msgs, ...messages];
    }
    const fragment = document.createDocumentFragment();
    messages.forEach(msg => {
        const el = createMessageElement(msg);
        fragment.appendChild(el);
    });
    if (!append) {
        elements.messageContainer.innerHTML = '';
        elements.messageContainer.appendChild(fragment);
        elements.messageContainer.scrollTop = elements.messageContainer.scrollHeight;
    } else {
        const oldScrollHeight = elements.messageContainer.scrollHeight;
        elements.messageContainer.prepend(fragment);
        elements.messageContainer.scrollTop = elements.messageContainer.scrollHeight - oldScrollHeight;
    }
}

export function addMessage(message) {
    messages.push(message);
    const el = createMessageElement(message);
    elements.messageContainer.appendChild(el);
    elements.messageContainer.scrollTop = elements.messageContainer.scrollHeight;
}

export function updateMessage(uuid, newData) {
    const index = messages.findIndex(m => m.UUID === uuid);
    if (index !== -1) {
        messages[index] = { ...messages[index], ...newData };
        renderMessages(messages);
    }
}

function createMessageElement(message) {
    const div = document.createElement('div');
    const isMine = message.sentBy === 'me' || message.sentBy === getUUID();
    div.className = `message ${isMine ? 'message-sent' : 'message-received'}`;
    div.dataset.uuid = message.UUID;
    const content = escapeHTML(message.content || '');
    const time = message.timestamp ? formatTime(message.timestamp) : '';
    const pending = message.isPending ? '<span class="pending">⏳</span>' : '';
    div.innerHTML = `
        <div class="message-content">${content}</div>
        <div class="message-time">${time} ${pending}</div>
    `;
    return div;
}

// --- Бесконечный скролл ---
let lastScrollTime = 0;
export function setupInfiniteScroll() {
    elements.messageContainer.addEventListener('scroll', () => {
        if (elements.messageContainer.scrollTop === 0 && !isLoadingMore) {
            const now = Date.now();
            if (now - lastScrollTime >= 1000) {
                lastScrollTime = now;
                isLoadingMore = true;
                wsClient.getMoreMessages();
                setTimeout(() => { isLoadingMore = false; }, 2000);
            }
        }
    });
}

// --- Модальное окно создания чата ---
let modalListenersAdded = false;

export function showNewChatModal() {
    const modal = document.getElementById('newChatModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('chatNameInput').value = '';
    document.getElementById('chatTargetInput').value = '';
    document.getElementById('chatTypeSelect').value = 'direct';
    toggleChatFields();
    if (!modalListenersAdded) {
        addModalListeners();
        modalListenersAdded = true;
    }
}

function addModalListeners() {
    const modal = document.getElementById('newChatModal');
    document.getElementById('closeModalBtn').onclick = hideModal;
    document.getElementById('cancelModalBtn').onclick = hideModal;
    document.getElementById('chatTypeSelect').onchange = toggleChatFields;
    document.getElementById('createChatBtn').onclick = handleCreateChat;
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });
}

function hideModal() {
    document.getElementById('newChatModal').style.display = 'none';
}

function toggleChatFields() {
    const type = document.getElementById('chatTypeSelect').value;
    const nameGroup = document.getElementById('chatNameGroup');
    const targetGroup = document.getElementById('chatTargetGroup');
    if (type === 'direct') {
        nameGroup.style.display = 'block';
        targetGroup.style.display = 'block';
        document.getElementById('chatNameInput').placeholder = 'Имя для чата (необязательно)';
    } else {
        nameGroup.style.display = 'block';
        targetGroup.style.display = 'none';
        document.getElementById('chatNameInput').placeholder = 'Название группы';
    }
}

async function handleCreateChat() {
    const type = document.getElementById('chatTypeSelect').value;
    const name = document.getElementById('chatNameInput').value.trim() || 'Новый чат';
    const targetUUID = document.getElementById('chatTargetInput').value.trim();
    try {
        if (type === 'direct') {
            if (!targetUUID) { showNotification('Введите UUID пользователя', 'error'); return; }
            await newDirectChat(name, targetUUID);
        } else {
            await newGroupChat(name);
        }
        showNotification('✅ Чат создан!', 'success');
        hideModal();
        wsClient.send({ action: 'REFRESH_CHATS' });
    } catch (error) {
        showNotification('❌ Ошибка: ' + (error.message || 'Не удалось создать чат'), 'error');
    }
}

// --- Уведомления (вместо alert) ---
function showNotification(text, type = 'info') {
    const colors = { success: '#22c55e', error: '#ef4444', info: '#6c63ff' };
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${colors[type] || colors.info};
        color: white; padding: 12px 24px;
        border-radius: 10px; font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999; animation: fadeIn 0.3s ease;
        max-width: 400px;
    `;
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.3s';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

// --- Выход ---
export function logout() {
    wsClient.disconnect();
    clearSession();
    showLoginPage();
    currentChatUUID = null;
    messages = [];
}

// --- Поиск пользователей ---
export function setupSearch() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    if (!searchBtn || !searchInput) return;

    const doSearch = async () => {
        const username = searchInput.value.trim();
        if (!username) return;
        try {
            const result = await searchUser(username);
            if (result.result === 'SUCCESS') {
                showNotification(`👤 Пользователь найден! UUID: ${result.UUID}`, 'success');
            } else {
                showNotification('Пользователь не найден', 'error');
            }
        } catch (error) {
            showNotification('Ошибка поиска', 'error');
        }
    };

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
    });
}

// --- Уведомления (вместо alert) ---
export function showNotification(text, type = 'info') {
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        info: '#6c63ff'
    };
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 10px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        animation: fadeIn 0.3s ease;
        max-width: 400px;
        transition: opacity 0.3s;
    `;
    div.textContent = text;
    document.body.appendChild(div);

    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 400);
    }, 3000);
}