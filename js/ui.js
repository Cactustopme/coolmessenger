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
        profilePage: document.getElementById('profilePage'),
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
        currentChatStatus: document.getElementById('currentChatStatus'),
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
    elements.profilePage.style.display = 'none';
    elements.chatPage.style.display = 'flex';
    elements.chatPage.style.flexDirection = 'column';
    const username = getUsername();
    if (username) {
        elements.userStatus.textContent = `👤 ${username}`;
    }
}

export function showProfilePage() {
    elements.chatPage.style.display = 'none';
    elements.profilePage.style.display = 'flex';
    elements.profilePage.style.flexDirection = 'column';
}

export function hideProfilePage() {
    elements.profilePage.style.display = 'none';
    elements.chatPage.style.display = 'flex';
    elements.chatPage.style.flexDirection = 'column';
}

export async function displayUserProfile(userData) {
    try {
        const username = userData.username || 'Неизвестно';
        const email = userData.email || 'Не указано';
        const phone = userData.phone || 'Не указано';
        const uuid = userData.UUID || 'Неизвестно';

        document.getElementById('profileUsername').textContent = username;
        document.getElementById('profileEmail').textContent = `📧 ${email}`;
        document.getElementById('profilePhone').textContent = `☎️ ${phone}`;
        document.getElementById('profileUUID').textContent = `🆔 ${uuid}`;

        const avatarLetter = (username || '?')[0].toUpperCase();
        document.getElementById('profileAvatar').textContent = avatarLetter;
    } catch (error) {
        console.error('Ошибка отображения профиля:', error);
        showNotification('Ошибка загрузки профиля', 'error');
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
            const member = getOtherChatMember(chat);
            chatName = getMemberUsername(member) || chat.name || '';
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

    if (currentChatUUID) {
        updateChatHeaderConnection(wsClient.isConnected);
    }
}

// --- Выбор чата ---
let currentChatUUID = null;
export let messages = {}; // hash table keyed by UUID
export let messagesOrder = []; // ordered UUIDs (oldest-first)
let isLoadingMore = false;
const userStatuses = new Map();
const chatStatuses = new Map();

function getChatMembers(chat) {
    return Array.isArray(chat?.members) ? chat.members : [];
}

function getMemberID(member) {
    if (typeof member === 'string') {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(member)
            ? member
            : null;
    }
    return member?.id || member?.UUID || member?.uuid || member?.userID || null;
}

function normalizeUserID(id) {
    return typeof id === 'string' ? id.toLowerCase() : null;
}

function getMemberUsername(member) {
    return typeof member === 'string' ? member : member?.username || '';
}

function getOtherChatMember(chat) {
    const members = getChatMembers(chat);
    const currentUUID = normalizeUserID(getUUID());
    const currentUsername = getUsername()?.toLowerCase();
    return members.find(member => {
        const id = normalizeUserID(getMemberID(member));
        const username = getMemberUsername(member).toLowerCase();
        return !(currentUUID && id === currentUUID) &&
            !(currentUsername && username === currentUsername);
    }) || members[0] || null;
}

function getMemberStatus(member, chat) {
    const memberID = getMemberID(member);
    const normalizedID = normalizeUserID(memberID);
    if (normalizedID && userStatuses.has(normalizedID)) {
        return userStatuses.get(normalizedID);
    }

    if (chat?.UUID && chatStatuses.has(chat.UUID)) {
        return chatStatuses.get(chat.UUID);
    }

    if (typeof member === 'object' && member) {
        return {
            active: member.active === true,
            typing: member.typing === true
        };
    }
    return null;
}

function renderCurrentChatStatus(chat) {
    const statusElement = elements.currentChatStatus;
    if (!statusElement) return;

    if (!chat || chat.isGroupChat) {
        statusElement.hidden = true;
        return;
    }

    const member = getOtherChatMember(chat);
    const status = getMemberStatus(member, chat);
    const active = status?.active === true;
    console.info('[STATUS][RENDER] Отображён статус собеседника', {
        memberID: getMemberID(member),
        status,
        active: status?.active,
        typing: status?.typing
    });
    statusElement.textContent = status?.typing
        ? 'Печатает...'
        : active ? 'В сети' : 'Не в сети';
    statusElement.className = `current-chat-status ${active ? 'online' : 'offline'}${status?.typing ? ' typing' : ''}`;
    statusElement.hidden = false;
}

export function updateOtherUserStatus(status) {
    const statusUser = status?.member || status?.user || {};
    const userID = status?.userID || status?.userId || status?.userUUID ||
        status?.UUID || status?.id || statusUser.id || statusUser.UUID || statusUser.userID;
    const active = status?.active ?? statusUser.active;
    const typing = status?.typing ?? statusUser.typing;
    const normalizedID = normalizeUserID(userID);
    if (!normalizedID || typeof active !== 'boolean' || typeof typing !== 'boolean') {
        console.warn('[STATUS][APPLY] Не удалось разобрать обновление статуса', status);
        return;
    }
    userStatuses.set(normalizedID, { active, typing });
    const chat = chatsList.find(item => item.UUID === currentChatUUID);
    if (!chat || chat.isGroupChat) {
        console.info('[STATUS][APPLY] Статус сохранён, но личный чат не выбран', {
            userID: normalizedID,
            active,
            typing
        });
        return;
    }

    const memberID = getMemberID(getOtherChatMember(chat));
    if (memberID && normalizeUserID(memberID) !== normalizedID) {
        console.info('[STATUS][APPLY] Обновление относится к другому пользователю', {
            receivedUserID: normalizedID,
            chatMemberID: normalizeUserID(memberID)
        });
        return;
    }

    if (!memberID) {
        chatStatuses.set(chat.UUID, { active, typing });
    }

    console.info('[STATUS][APPLY] Статус собеседника обновлён', {
        userID: normalizedID,
        chatUUID: chat.UUID,
        matchedBy: memberID ? 'userID' : 'current-chat-fallback',
        active,
        typing
    });
    renderCurrentChatStatus(chat);
}

export function updateChatHeaderConnection(connected) {
    const header = document.querySelector('.current-chat-bar');
    const nameElement = document.getElementById('currentChatName');
    if (!header || !nameElement) return;

    if (!connected) {
        nameElement.textContent = 'Соединение';
        header.classList.add('is-disconnected');
        if (elements.currentChatStatus) {
            elements.currentChatStatus.hidden = true;
        }
        return;
    }
    const chat = chatsList.find(item => item.UUID === currentChatUUID);
    const chatName = chat
        ? (chat.isGroupChat
            ? chat.name
            : getMemberUsername(getOtherChatMember(chat)) || chat.name)
        : '';

    nameElement.textContent = chatName || 'Чат';
    header.classList.remove('is-disconnected');
    renderCurrentChatStatus(chat);
}

export function selectChat(chatUUID) {
    currentChatUUID = chatUUID;
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.uuid === chatUUID);
    });
    elements.chatWelcome.style.display = 'none';
    elements.chatWindow.style.display = 'flex';
    updateChatHeaderConnection(wsClient.isConnected);
    elements.messageContainer.innerHTML = '<div class="loading">Загрузка сообщений...</div>';
    wsClient.openChat(chatUUID);
}

// --- Рендер сообщений ---
export function renderMessages(msgs, append = false) {
    // msgs is expected to be an array in display order (oldest-first)
    if (!Array.isArray(msgs)) msgs = [];

    if (!append) {
        // Replace current messages
        messages = {};
        messagesOrder = [];
        msgs.forEach(m => {
            if (m && m.UUID) {
                messages[m.UUID] = m;
                messagesOrder.push(m.UUID);
            }
        });
        elements.messageContainer.innerHTML = '';
    } else {
        // Prepend older messages (msgs are older than existing)
        const newUUIDs = [];
        msgs.forEach(m => {
            if (m && m.UUID && !messages[m.UUID]) {
                messages[m.UUID] = m;
                newUUIDs.push(m.UUID);
            }
        });
        messagesOrder = [...newUUIDs, ...messagesOrder];
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
    const targetChatUUID = chatUUID || currentChatUUID;

    if (!message || !message.UUID) return;

    if (targetChatUUID === currentChatUUID) {
        // Append to end (newest)
        if (!messages[message.UUID]) {
            messages[message.UUID] = message;
            messagesOrder.push(message.UUID);
        } else {
            messages[message.UUID] = { ...messages[message.UUID], ...message };
        }
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
    if (!uuid || !messages[uuid]) return;
    messages[uuid] = { ...messages[uuid], ...newData };
    // Re-render messages preserving order
    const ordered = messagesOrder.map(id => messages[id]).filter(Boolean);
    renderMessages(ordered);
}

export function getEarliestMessage() {
    if (!messagesOrder || messagesOrder.length === 0) return null;
    const id = messagesOrder[0];
    return messages[id] || null;
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
    messages = {};
    messagesOrder = [];
}

// --- Поиск пользователей ---
export function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

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