import { escapeHTML, formatTime, generateUUID } from './utils.js';
import { getUsername, getSession, clearSession } from './auth.js';
import { wsClient } from './websocket.js';
import { newDirectChat, newGroupChat, searchUser } from './api.js';

// DOM элементы (инициализируем при загрузке)
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
    };
}

// === Управление страницами ===

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
    
    // Обновляем статус
    const username = getUsername();
    if (username) {
        elements.userStatus.textContent = `👤 ${username}`;
    }
}

// === Рендер списка чатов ===

let g_Chats = [];

export function renderChats(chats) {
    g_Chats.push(...chats)
    if (!elements.chatList) return;
    
    if (!g_Chats || g_Chats.length === 0) {
        elements.chatList.innerHTML = `
            <div class="empty-state">
                <p>Нет чатов</p>
                <button class="btn-primary" id="createFirstChat">Создать чат</button>
            </div>
        `;
        const btn = document.getElementById('createFirstChat');
        if (btn) btn.addEventListener('click', () => showNewChatDialog());
        return;
    }

    let html = '';
    g_Chats.forEach(chat => {
        const lastMsg = chat.lastMessage ? escapeHTML(chat.lastMessage) : 'Нет сообщений';
        const time = chat.lastMessageTimeSent ? formatTime(chat.lastMessageTimeSent) : '';
        html += `
            <div class="chat-item" data-uuid="${chat.UUID}">
                <div class="chat-name">${escapeHTML(chat.name || 'Без названия')}</div>
                <div class="chat-last">${lastMsg}</div>
                <div class="chat-time">${time}</div>
            </div>
        `;
    });

    elements.chatList.innerHTML = html;

    // Добавляем обработчики клика
    elements.chatList.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', () => {
            const uuid = el.dataset.uuid;
            selectChat(uuid);
        });
    });
}

// === Выбор чата ===

let currentChatUUID = null;
let messages = [];
let isLoadingMore = false;

export function selectChat(chatUUID) {
    currentChatUUID = chatUUID;
    
    // Подсвечиваем выбранный чат
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.uuid === chatUUID);
    });

    // Показываем окно чата
    elements.chatWelcome.style.display = 'none';
    elements.chatWindow.style.display = 'flex';
    elements.messageContainer.innerHTML = '<div class="loading">Загрузка сообщений...</div>';

    // Запрашиваем сообщения через WS
    wsClient.openChat(chatUUID);
}

// === Рендер сообщений ===

export function renderMessages(msgs, append = false) {
    if (!append) {
        messages = msgs || [];
        elements.messageContainer.innerHTML = '';
    } else {
        // Добавляем старые сообщения в начало
        messages = [...msgs, ...messages];
    }

    // Рендерим все сообщения
    const fragment = document.createDocumentFragment();
    messages.forEach(msg => {
        const el = createMessageElement(msg);
        fragment.appendChild(el);
    });

    if (!append) {
        elements.messageContainer.innerHTML = '';
        elements.messageContainer.appendChild(fragment);
        // Скроллим вниз
        elements.messageContainer.scrollTop = elements.messageContainer.scrollHeight;
    } else {
        // При добавлении старых - сохраняем позицию
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
        // Перерендериваем всё (проще, чем искать DOM элемент)
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

    // Кнопки для своих сообщений
    if (isMine && !message.isPending) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        actions.innerHTML = `
            <button class="edit-msg" data-uuid="${message.UUID}">✏️</button>
            <button class="delete-msg" data-uuid="${message.UUID}">🗑️</button>
        `;
        div.appendChild(actions);

        actions.querySelector('.edit-msg').addEventListener('click', (e) => {
            e.stopPropagation();
            const newText = prompt('Редактировать сообщение:', message.content);
            if (newText && newText.trim()) {
                wsClient.editMessage(message.UUID, newText.trim());
            }
        });

        actions.querySelector('.delete-msg').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить сообщение?')) {
                wsClient.deleteMessage(message.UUID);
            }
        });
    }

    return div;
}

// === Обработка прокрутки (бесконечный скролл) ===

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

// === Диалог создания чата ===

export function showNewChatDialog() {
    const choice = confirm('Создать личный чат? (OK - личный, Отмена - групповой)');
    if (choice) {
        // Личный чат
        const targetUUID = prompt('Введите UUID пользователя:');
        if (targetUUID && targetUUID.trim()) {
            const name = prompt('Введите имя чата:') || 'Личный чат';
            newDirectChat(name, targetUUID.trim())
                .then(() => alert('Чат создан!'))
                .catch(err => alert('Ошибка: ' + err.message));
        }
    } else {
        // Групповой чат
        const name = prompt('Введите название группового чата:');
        if (name && name.trim()) {
            newGroupChat(name.trim())
                .then(() => alert('Группа создана!'))
                .catch(err => alert('Ошибка: ' + err.message));
        }
    }
}

// === Выход ===

export function logout() {
    if (confirm('Выйти из аккаунта?')) {
        wsClient.disconnect();
        clearSession();
        showLoginPage();
        // Очищаем состояние
        currentChatUUID = null;
        messages = [];
    }
}

// === Показ ошибок ===

export function showLoginError(message) {
    const el = elements.loginError;
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}

export function showSignupError(message) {
    const el = elements.signupError;
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}