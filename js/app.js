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
    getSession,
    isAuthenticated,
    loadCredentials
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

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] Приложение загружается...');
    initUI();
    setupEventListeners();
    setupWebSocketHandlers();
    setupSearch();
    initMenu();

    console.log('[DOMContentLoaded] Проверяю sessionStorage...');
    const sessionLoaded = loadSession();
    const isAuth = isAuthenticated();
    console.log('[DOMContentLoaded] loadSession():', sessionLoaded, 'isAuthenticated():', isAuth);
     
    if (sessionLoaded && isAuth) {
        console.log('✓ Восстановление сессии из sessionStorage');
        restoreSession();
    } else {
        console.log('[DOMContentLoaded] sessionStorage пуст, проверяю localStorage...');
        // Check for stored credentials (UUID + Token) for auto-login
        const creds = loadCredentials();
        console.log('[DOMContentLoaded] Результат loadCredentials():', creds ? 'найдено' : 'не найдено');
         
        if (creds && (creds.uuid || creds.sessionID || creds.refreshToken)) {
            console.log('✓ Найдены сохраненные учетные данные, выполняю автовход...');
            autoLogin(creds.uuid, creds.token, creds.refreshToken, creds.deviceID);
        } else {
            console.log('✗ Учетные данные не найдены, показываю форму входа');
            showLoginPage();
        }
    }
});

async function refreshSessionIfNeeded() {
    const current = getSession();
    if (!current.refreshToken || !current.deviceID) {
        return false;
    }

    if (current.sessionID) {
        const valid = await isSessionValid();
        if (valid === true) {
            return true;
        }
    }

    const refreshed = await refreshSession(current.deviceID, current.refreshToken);
    if (refreshed.result !== 'SUCCESS') {
        throw new Error(refreshed.result || 'SESSION_INVALID');
    }

    saveSession({
        uuid: current.uuid,
        token: current.token,
        sessionID: refreshed.sessionID,
        refreshToken: refreshed.refreshToken,
        deviceID: current.deviceID,
        username: current.username
    });

    return true;
}

async function restoreSession() {
    try {
        const valid = await refreshSessionIfNeeded();
        if (!valid) {
            throw new Error('No session available');
        }
        await getThisUserData();
        wsClient.connect();
        showChatPage();
    } catch (error) {
        console.warn('Сессия недействительна, требуется повторный вход');
        clearSession();
        showLoginPage();
    }
}

async function autoLogin(uuid, token, refreshToken = null, deviceID = null) {
    try {
        const currentSession = getSession();
        if (!currentSession.sessionID && refreshToken && deviceID) {
            saveSession({ uuid, token, sessionID: null, refreshToken, deviceID, username: null });
        }

        const isValid = await refreshSessionIfNeeded();
        if (!isValid) {
            throw new Error('Нет активной сессии');
        }

        const userData = await getThisUserData();
        if (userData && userData.result === 'SUCCESS') {
            saveSession({
                uuid: currentSession.uuid || uuid,
                token: currentSession.token || token,
                sessionID: getSession().sessionID,
                refreshToken: getSession().refreshToken,
                deviceID: getSession().deviceID,
                username: userData.username
            });
        }

        wsClient.connect();
        showChatPage();
        console.log('✓ Автовход успешен!');
    } catch (error) {
        console.error('✗ Ошибка автовхода:', error);
        clearSession();
        showLoginPage();
    }
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
            const current = getSession();
            if (!current.refreshToken || !current.deviceID) {
                clearSession();
                showLoginPage();
                return;
            }

            try {
                const refreshed = await refreshSession(current.deviceID, current.refreshToken);
                if (refreshed.result === 'SUCCESS') {
                    saveSession({
                        uuid: current.uuid,
                        token: current.token,
                        sessionID: refreshed.sessionID,
                        refreshToken: refreshed.refreshToken,
                        deviceID: current.deviceID,
                        username: current.username
                    });
                    wsClient.disconnect();
                    wsClient.connect();
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

