import { CONFIG } from './config.js';
import {
    signup,
    userLogin,
    isSessionValid,
    refreshSession,
    getThisUserData,
    newDirectChat,
    newGroupChat,
    searchUser
} from './api.js';
import {
    saveSession,
    loadSession,
    clearSession,
    getUUID,
    getSession
} from './auth.js';
import { wsClient } from './websocket.js';
import {
    initUI, showLoginPage, showChatPage, showProfilePage, hideProfilePage,
    renderChats, renderMessages, addMessage, updateMessage,
    getEarliestMessage,
    selectChat, setupInfiniteScroll,
    showNewChatModal, logout,
    showLoginError, showSignupError, setupSearch, showNotification, hideNewChatModal
} from './ui.js';
import { initMenu } from './menu.js';

let sessionRefreshPromise = null;
let sessionExpiredPromise = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] Приложение загружается...');
    initUI();
    setupEventListeners();
    setupWebSocketHandlers();
    setupSearch();
    initMenu();

    if (loadSession()) {
        console.log('✓ Найдены данные авторизации в cookies, проверяю сессию...');
        document.getElementById('loginPage').style.display = 'none';
        restoreSession();
    } else {
        showLoginPage();
    }
});

async function refreshSessionIfNeeded() {
    const current = getSession();
    console.log('[AUTH] Проверка сессии начата', {
        hasSessionID: Boolean(current.sessionID),
        hasRefreshToken: Boolean(current.refreshToken),
        hasDeviceID: Boolean(current.deviceID)
    });

    if (current.sessionID) {
        try {
            const valid = await isSessionValid();
            console.log('[AUTH] /is_session_valid ответ:', valid);
            if (valid === true) {
                console.log('[AUTH] Сессия действительна, обновление не требуется');
                return true;
            }
            console.warn('[AUTH] Сессия недействительна, требуется обновление');
        } catch (error) {
            console.error('[AUTH] Ошибка проверки сессии:', error);
        }
    }

    if (!current.refreshToken || !current.deviceID) {
        console.error('[AUTH] Невозможно обновить сессию: отсутствует refreshToken или deviceID');
        return false;
    }

    try {
        console.log('[AUTH] Отправка запроса /refresh_session');
        const refreshed = await refreshSession(current.deviceID, current.refreshToken);
        console.log('[AUTH] /refresh_session ответ:', {
            result: refreshed?.result,
            hasSessionID: Boolean(refreshed?.sessionID),
            hasRefreshToken: Boolean(refreshed?.refreshToken)
        });


        if (refreshed.result !== 'SUCCESS' && refreshed.result) {
            throw new Error(refreshed.result || 'SESSION_INVALID');
        }

        if (!refreshed.sessionID || !refreshed.refreshToken) {
            throw new Error('Некорректный ответ /refresh_session: отсутствует sessionID или refreshToken');
        }

        saveSession({
            uuid: current.uuid,
            token: current.token,
            sessionID: refreshed.sessionID,
            refreshToken: refreshed.refreshToken,
            deviceID: current.deviceID,
            username: current.username
        });

        console.log('[AUTH] Сессия успешно обновлена, cookies заменены новыми данными');
        return true;
    } catch (error) {
        console.error('[AUTH] Ошибка обновления сессии:', error);
        throw error;
    }
}

async function restoreSession() {
    try {
        console.log('[AUTH] Восстановление сессии при загрузке страницы');
        const valid = await refreshSessionIfNeeded();
        if (!valid) {
            throw new Error('No session available');
        }
        await getThisUserData();
        wsClient.connect();
        showChatPage();
        console.log('[AUTH] Сессия восстановлена, WebSocket подключается');
    } catch (error) {
        console.error('[AUTH] Не удалось восстановить сессию, требуется повторный вход:', error);
        clearSession();
        showLoginPage();
    }
}

async function refreshActiveSession(reason) {
    if (sessionRefreshPromise) {
        console.log(`[AUTH] Обновление сессии уже выполняется, ожидаю текущий запрос (${reason})`);
        return sessionRefreshPromise;
    }

    sessionRefreshPromise = (async () => {
        const current = getSession();
        console.log(`[AUTH] Начало обновления сессии (${reason})`, {
            hasOldSessionID: Boolean(current.sessionID),
            hasOldRefreshToken: Boolean(current.refreshToken),
            hasDeviceID: Boolean(current.deviceID)
        });
        if (!current.refreshToken || !current.deviceID) {
            throw new Error(`Невозможно обновить сессию после ${reason}: отсутствует refreshToken или deviceID`);
        }

        console.log(`[AUTH] Отправляю /refresh_session (${reason})`);
        const refreshed = await refreshSession(current.deviceID, current.refreshToken);
        console.log(`[AUTH] Получен ответ /refresh_session (${reason})`, {
            result: refreshed?.result,
            hasNewSessionID: Boolean(refreshed?.sessionID),
            hasNewRefreshToken: Boolean(refreshed?.refreshToken),
            refreshTokenChanged: Boolean(refreshed?.refreshToken) && refreshed.refreshToken !== current.refreshToken
        });
        if (refreshed?.result && refreshed.result !== 'SUCCESS') {
            throw new Error(refreshed.result);
        }
        if (!refreshed?.sessionID || !refreshed?.refreshToken) {
            throw new Error('Некорректный ответ /refresh_session: отсутствует sessionID или refreshToken');
        }

        saveSession({
            uuid: current.uuid,
            token: current.token,
            sessionID: refreshed.sessionID,
            refreshToken: refreshed.refreshToken,
            deviceID: current.deviceID,
            username: current.username
        });
        const saved = getSession();
        console.log(`[AUTH] Новая сессия сохранена (${reason})`, {
            sessionIDChanged: saved.sessionID !== current.sessionID,
            refreshTokenChanged: saved.refreshToken !== current.refreshToken,
            hasSavedRefreshToken: Boolean(saved.refreshToken)
        });
        return true;
    })().finally(() => {
        sessionRefreshPromise = null;
    });

    return sessionRefreshPromise;
}

async function handleSessionExpired() {
    if (sessionExpiredPromise) return sessionExpiredPromise;

    sessionExpiredPromise = (async () => {
        try {
            console.log('[WS][AUTH] Начинаю обработку SESSION_EXPIRED');
            await refreshActiveSession('SESSION_EXPIRED');
            console.log('[WS][AUTH] Сессия обновлена, запускаю переподключение WebSocket');
            wsClient.reconnectWithSession();
            showNotification('🔄 Сессия обновлена', 'success');
        } catch (error) {
            console.error('[AUTH] Не удалось обновить истёкшую сессию:', error);
            clearSession();
            wsClient.disconnect();
            showLoginPage();
        }
    })().finally(() => {
        sessionExpiredPromise = null;
    });

    return sessionExpiredPromise;
}

function setupEventListeners() {
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
    document.getElementById("closeModalBtn")?.addEventListener("click", hideNewChatModal);
    document.getElementById("createChatBtn")?.addEventListener("click", handleCreateChat);
    document.getElementById("cancelModalBtn")?.addEventListener("click", hideNewChatModal);
    document.getElementById("menuNewChat")?.addEventListener('click', showNewChatModal);
    document.getElementById('showSignup')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.auth-box').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.auth-box')[1].style.display = 'block';
    });

    document.getElementById('showLogin')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.auth-box').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.auth-box')[0].style.display = 'block';
    });

    document.getElementById('sendButton')?.addEventListener('click', handleSendMessage);
    document.getElementById('messageInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    document.getElementById('newChatBtn')?.addEventListener('click', showNewChatModal);
     
    document.getElementById("chatTypeSelect")?.addEventListener("change", updateNewChatModalFields);
    updateNewChatModalFields();
    setupInfiniteScroll(async () => {
        const earliestMessage = getEarliestMessage();
        const ts = earliestMessage ? earliestMessage.timestamp : null;
        wsClient.getMoreMessages(ts);
    });

    // Profile page buttons
    document.getElementById('backFromProfileBtn')?.addEventListener('click', () => {
        hideProfilePage();
    });
    document.getElementById('logoutFromProfileBtn')?.addEventListener('click', logout);
}

// --- ЛОГИН ---
async function handleLogin(e) {
    e.preventDefault();

    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Очищаем старые ошибки
    usernameInput.style.borderColor = '';
    passwordInput.style.borderColor = '';
    document.getElementById('loginError').style.display = 'none';

    if (!username || !password) {
        if (!username) usernameInput.style.borderColor = '#ef4444';
        if (!password) passwordInput.style.borderColor = '#ef4444';
        showLoginError('Заполните все поля');
        return;
    }

    try {
        const loginResult = await userLogin(username, password);
        if (loginResult.result !== 'SUCCESS') {
            showLoginError(loginResult.result || 'Ошибка входа');
            return;
        }

        saveSession({
            uuid: loginResult.UUID,
            token: loginResult.token || null,
            sessionID: loginResult.session,
            refreshToken: loginResult.refreshToken,
            deviceID: loginResult.deviceID,
            username: null
        });

        try {
            const userData = await getThisUserData();
            if (userData && userData.result === 'SUCCESS') {
                saveSession({
                    uuid: loginResult.UUID,
                    token: loginResult.token || null,
                    sessionID: loginResult.session,
                    refreshToken: loginResult.refreshToken,
                    deviceID: loginResult.deviceID,
                    username: userData.username
                });
            }
        } catch (e) {
            console.warn('Не удалось получить данные пользователя');
        }

        wsClient.connect();
        showChatPage();
        usernameInput.value = '';
        passwordInput.value = '';
    } catch (error) {
        console.error('Ошибка входа:', error);
        showLoginError(error?.message || 'Ошибка соединения с сервером');
    }
}

// --- РЕГИСТРАЦИЯ (исправлена!) ---
async function handleSignup(e) {
    e.preventDefault();

    const emailInput = document.getElementById('signupEmail');
    const usernameInput = document.getElementById('signupUsername');
    const passwordInput = document.getElementById('signupPassword');
    const phoneInput = document.getElementById('signupPhone');

    const email = emailInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const phone = phoneInput.value.trim();

    // Очищаем старые ошибки
    [emailInput, usernameInput, passwordInput].forEach(el => el.style.borderColor = '');
    document.getElementById('signupError').style.display = 'none';

    if (!email || !username || !password) {
        if (!email) emailInput.style.borderColor = '#ef4444';
        if (!username) usernameInput.style.borderColor = '#ef4444';
        if (!password) passwordInput.style.borderColor = '#ef4444';
        showSignupError('Заполните все обязательные поля');
        return;
    }

    if (username.length < 3) {
        usernameInput.style.borderColor = '#ef4444';
        showSignupError('Имя пользователя должно быть не менее 3 символов');
        return;
    }

    if (password.length < 6) {
        passwordInput.style.borderColor = '#ef4444';
        showSignupError('Пароль должен быть не менее 6 символов');
        return;
    }

    try {
        const result = await signup(email, username, password, phone);
        if (result.result !== 'SUCCESS') {
            showSignupError(result.result || 'Ошибка регистрации');
            return;
        }

        saveSession({
            uuid: result.UUID,
            token: result.token || null,
            sessionID: result.session,
            refreshToken: result.refreshToken,
            deviceID: result.deviceID,
            username
        });

        showNotification('✅ Регистрация успешна! Теперь войдите.', 'success');

        document.querySelectorAll('.auth-box').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.auth-box')[0].style.display = 'block';

        document.getElementById('loginUsername').value = username;
        document.getElementById('loginPassword').value = '';

        emailInput.value = '';
        usernameInput.value = '';
        passwordInput.value = '';
        phoneInput.value = '';
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        showSignupError(error?.message || 'Ошибка соединения с сервером');
    }
}

// --- ОТПРАВКА СООБЩЕНИЯ ---
function handleSendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content) return;

    const localUUID = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toISOString();

    wsClient.sendMessage(content, timestamp, localUUID);
    addMessage({
        UUID: localUUID,
        content: content,
        sentBy: 'me',
        timestamp: timestamp,
        isPending: true
    });

    input.value = '';
    input.style.height = 'auto';
}

// --- НОВЫЙ ЧАТ ---
function updateNewChatModalFields() {
    const chatType = document.getElementById('chatTypeSelect')?.value;
    const chatNameGroup = document.getElementById('chatNameGroup');
    const chatTargetGroup = document.getElementById('chatTargetGroup');

    if (!chatNameGroup || !chatTargetGroup) {
        return;
    }

    if (chatType === 'direct') {
        chatNameGroup.style.display = 'none';
        chatTargetGroup.style.display = 'block';
    } else {
        chatNameGroup.style.display = 'block';
        chatTargetGroup.style.display = 'none';
    }
}

async function handleCreateChat(event) {
    event.preventDefault();

    const chatType = document.getElementById('chatTypeSelect')?.value;
    const chatName = document.getElementById('chatNameInput')?.value.trim();
    const username = document.getElementById('directUsername')?.value.trim();
    const createChatBtn = document.getElementById('createChatBtn');

    try {
        if (createChatBtn) {
            createChatBtn.disabled = true;
            createChatBtn.textContent = 'Создание...';
        }

        let createdChat;

        if (chatType === 'direct') {
            if (!username) {
                showNotification('Введите имя пользователя');
                return;
            }

            let userData = await searchUser(username)

            createdChat = await newDirectChat(userData.UUID);
        } else if (chatType === 'group') {
            if (!chatName) {
                showNotification('Введите название группового чата');
                return;
            }

            createdChat = await newGroupChat(chatName);
        } else {
            showNotification('Неизвестный тип чата');
            return;
        }

        hideNewChatModal();

        document.getElementById('chatNameInput').value = '';
        document.getElementById('directUsername').value = '';

        const chatUUID =
            createdChat?.UUID ||
            createdChat?.uuid ||
            createdChat?.chatUUID ||
            createdChat?.chat?.UUID ||
            createdChat?.chat?.uuid;

        if (chatUUID) {
            wsClient.openChat(chatUUID);
        }

        showNotification('Чат создан');
    } catch (error) {
        console.error('Ошибка создания чата:', error);
        showNotification(error?.message || 'Не удалось создать чат');
    } finally {
        if (createChatBtn) {
            createChatBtn.disabled = false;
            createChatBtn.textContent = 'Создать';
        }
    }
}

function pong(){
    console.log("Sending Pong!!!")
    wsClient.send({
        action: 'PONG',
        isActive: true,
        isTyping : false,
    })
}

// Сервер может присылать UUID чата под разными именами
function extractChatUUID(data) {
    return data?.chatUUID || data?.chatID || data?.chat?.UUID || null;
}

// --- WEBSOCKET ---
function setupWebSocketHandlers() {
    wsClient.on('chatsUpdate', (chats) => { renderChats(chats); });
    wsClient.on('chatOpened', (messages) => { renderMessages(messages); });

    wsClient.on('ping', (_) => {
        pong()
    })
    wsClient.on('sessionExpired', async () => {
        await handleSessionExpired();
    });

    wsClient.on('moreMessages', (oldMessages) => {
        console.log("Old messages (2)");
        renderMessages(oldMessages, true); }
    );
    wsClient.on('newMessage', (data) => {
        const chatUUID = extractChatUUID(data);
        for (let message of data.messages || []){
            addMessage(message, chatUUID || extractChatUUID(message));
        }
    });

    wsClient.on('messageConfirmed', (data) => {
        console.log("messageConfirmed (2)");
        updateMessage(data.localUUID, { UUID: data.realUUID, isPending: false });
    });

    wsClient.on('messageDeleted', (data) => {
        updateMessage(data.messageUUID, { content: '🗑️ Сообщение удалено' });
    });

    wsClient.on('messageEdited', (data) => {
        updateMessage(data.messageUUID, { content: data.newText });
    });

    wsClient.on('connectionState', (connected) => {
        const statusEl = document.getElementById('userStatus');
        if (connected) {
            statusEl.textContent = '🟢 Онлайн';
            statusEl.className = 'status online';
        } else {
            statusEl.textContent = '🔴 Офлайн (переподключение...)';
            statusEl.className = 'status offline';
        }
    });

    wsClient.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
        showNotification('⚠️ Ошибка соединения', 'error');
    });

    wsClient.on('result', async (data) => {
        if (data.result === 'SESSION_INVALID') {
            console.warn('[AUTH] WebSocket сообщил SESSION_INVALID, запускаю обновление сессии');
            try {
                await refreshActiveSession('SESSION_INVALID');
                if (wsClient.reconnectWithSession) {
                    wsClient.reconnectWithSession();
                    showNotification('🔄 Сессия обновлена', 'success');
                    return;
                }
            } catch (error) {
                console.error('Ошибка обновления сессии после SESSION_INVALID:', error);
            }

            clearSession();
            showLoginPage();
            return;
        }

        if (data.result === 'SUCCESS') {
            console.log('Операция успешна');
        } else {
            console.warn('Операция вернула ошибку:', data.result);
            showNotification('❌ ' + (data.result || 'Ошибка операции'), 'error');
        }
    });
}

window.addEventListener('beforeunload', () => { wsClient.disconnect(); });

document.addEventListener('input', (e) => {
    if (e.target.id === 'messageInput') {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    }
});

console.log('🚀 Cool Messenger загружен!');
