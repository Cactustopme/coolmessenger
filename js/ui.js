import { escapeHTML, formatTime, generateUUID } from './utils.js';
import { getUsername, getSession, clearSession, getUUID } from './auth.js';
import { wsClient } from './websocket.js';
import {getThisUserData, newDirectChat, newGroupChat, searchUser} from './api.js';

let elements = {};
export let chatsList = [];

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
    chatsList = chats || [];
    if (!elements.chatList) return;

    Array.from(elements.chatList.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.remove();
            return;
        }

        if (
            node.nodeType === Node.ELEMENT_NODE &&
            !node.classList.contains('chat-item')
        ) {
            node.remove();
        }
    });

    if (!chats || chats.length === 0) {
        if (!elements.chatList.querySelector('.chat-item')) {
            elements.chatList.innerHTML = `<div class="empty-state"><p>Нет чатов</p></div>`;
        }
        return;
    }

    chats.forEach(chat => {
        const lastMsg = chat.lastMessage ? escapeHTML(chat.lastMessage) : 'Нет сообщений';
        const time = chat.lastMessageTimeSent ? formatTime(chat.lastMessageTimeSent) : '';

        let chatName = '';

        if (!chat.isGroupChat) {
            for (const member of chat.members || []) {
                if (member !== getUsername()) {
                    chatName = member;
                    break;
                }
            }
        } else {
            chatName = chat.name || '';
        }

        const avatarLetter = (chatName || chat.name || '?')[0].toUpperCase();

        const template = document.createElement('template');
        template.innerHTML = `
            <div class="chat-item" data-uuid="${escapeHTML(chat.UUID)}">
                <div class="chat-avatar">${escapeHTML(avatarLetter)}</div>
                <div class="chat-info">
                    <div class="chat-name">${escapeHTML(chatName)}</div>
                    <div class="chat-last">${lastMsg}</div>
                </div>
                <div class="chat-time">${time}</div>
            </div>
        `;

        const newChatElement = template.content.firstElementChild;

        newChatElement.addEventListener('click', () => {
            selectChat(chat.UUID);
        });

        if (chat.UUID === currentChatUUID) {
            newChatElement.classList.add('active');
        }

        const existingChatElement = elements.chatList.querySelector(
            `.chat-item[data-uuid="${CSS.escape(chat.UUID)}"]`
        );

        if (existingChatElement) {
            existingChatElement.replaceWith(newChatElement);
        } else {
            elements.chatList.appendChild(newChatElement);
        }
    });
}

// --- Выбор чата ---
let currentChatUUID = null;
export let messages = [];
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
        console.log(msgs);
        messages = [...msgs, ...messages];
        console.log(messages);
    }
    const fragment = document.createDocumentFragment();
    msgs.forEach(msg => {
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

export function addMessage(message, chatUUID = null) {
    // Если чат сообщения неизвестен — считаем, что это открытый чат
    const targetChatUUID = chatUUID || currentChatUUID;

    if (targetChatUUID === currentChatUUID) {
        messages.push(message);
        const el = createMessageElement(message);
        elements.messageContainer.appendChild(el);
        elements.messageContainer.scrollTop = elements.messageContainer.scrollHeight;
    }

    updateChatLastMessage(targetChatUUID, message);
}

// --- Последнее сообщение в списке чатов ---
export function updateChatLastMessage(chatUUID, message) {
    if (!chatUUID || !message) return;

    // Update in-memory chats list
    if (Array.isArray(chatsList)) {
        const idx = chatsList.findIndex(c => c.UUID === chatUUID);
        if (idx !== -1) {
            chatsList[idx].lastMessage = message.content || chatsList[idx].lastMessage;
            chatsList[idx].lastMessageTimeSent = message.timestamp || chatsList[idx].lastMessageTimeSent;
        } else {
            // Insert a minimal placeholder so the chat appears in the list
            chatsList.unshift({
                UUID: chatUUID,
                name: '',
                lastMessage: message.content || '',
                lastMessageTimeSent: message.timestamp || null,
                members: [],
                isGroupChat: false
            });
        }
    }

    if (!elements.chatList) return;

    const chatElement = elements.chatList.querySelector(
        `.chat-item[data-uuid="${CSS.escape(chatUUID)}"]`
    );

    if (!chatElement) {
        // If DOM entry is missing, re-render the chats list so it appears
        renderChats(chatsList);
        return;
    }

    const lastEl = chatElement.querySelector('.chat-last');
    if (lastEl) {
        lastEl.textContent = message.content || 'Нет сообщений';
    }

    const timeEl = chatElement.querySelector('.chat-time');
    if (timeEl) {
        timeEl.textContent = message.timestamp ? formatTime(message.timestamp) : '';
    }
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
export function setupInfiniteScroll(loadOlderMessages) {
    const messagesContainer = document.querySelector('.chat-messages');

    if (!messagesContainer) {
        return;
    }

    const THRESHOLD_PX = 200;

    let isLoading = false;
    let hasMoreMessages = true;
    let waitUntilLeaveTopZone = false;

    messagesContainer.addEventListener('scroll', async () => {
        const nearTop = messagesContainer.scrollTop <= THRESHOLD_PX;

        // Если после прошлой загрузки пользователь ушёл ниже порога —
        // разрешаем следующую загрузку при новом подходе к верху
        if (!nearTop && waitUntilLeaveTopZone) {
            waitUntilLeaveTopZone = false;
        }

        if (
            !nearTop ||
            isLoading ||
            !hasMoreMessages ||
            waitUntilLeaveTopZone
        ) {
            return;
        }

        isLoading = true;

        const previousScrollHeight = messagesContainer.scrollHeight;
        const previousScrollTop = messagesContainer.scrollTop;

        try {
            await loadOlderMessages();

            requestAnimationFrame(() => {
                const newScrollHeight = messagesContainer.scrollHeight;
                const heightDiff = newScrollHeight - previousScrollHeight;

                // Сохраняем текущую визуальную позицию пользователя
                messagesContainer.scrollTop = previousScrollTop + heightDiff;

                // Запрещаем повторную загрузку, пока пользователь не прокрутит вниз
                waitUntilLeaveTopZone = true;
            });
        } catch (error) {
            console.error('Ошибка загрузки старых сообщений:', error);
        } finally {
            isLoading = false;
        }
    }, {passive: true});
}

// --- Модальное окно создания чата ---
let modalListenersAdded = false;

export function showNewChatModal() {
    const modal = document.getElementById('newChatModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

export function hideNewChatModal() {
    const modal = document.getElementById('newChatModal');
    if (modal) {
        modal.style.display = 'none';
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
export function showNotification(text, type = 'info') {
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