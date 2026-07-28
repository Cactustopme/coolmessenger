import { CONFIG } from './config.js';
import { signup, userLogin, appLogin, getThisUserData } from './api.js';
import { saveSession, loadSession, clearSession, getUUID, isAuthenticated } from './auth.js';
import { wsClient } from './websocket.js';
import {
    initUI, showLoginPage, showChatPage,
    renderChats, renderMessages, addMessage, updateMessage,
    selectChat, setupInfiniteScroll,
    showNewChatModal, logout,
    showLoginError, showSignupError, setupSearch, showNotification
} from './ui.js';
import { initMenu } from './menu.js';

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    setupEventListeners();
    setupInfiniteScroll();
    setupWebSocketHandlers();
    setupSearch();
    initMenu();

    if (loadSession() && isAuthenticated()) {
        restoreSession();
    } else {
        showLoginPage();
    }
});

async function restoreSession() {
    try {
        await getThisUserData();
        wsClient.connect();
        showChatPage();
    } catch (error) {
        console.warn('Сессия недействительна, требуется вход');
        clearSession();
        showLoginPage();
    }
}

function setupEventListeners() {
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('signupForm')?.addEventListener('submit', handleSignup);

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

        const appResult = await appLogin(loginResult.UUID, loginResult.token);
        if (appResult.result !== 'SUCCESS') {
            showLoginError(appResult.result || 'Ошибка создания сессии');
            return;
        }

        saveSession(loginResult.UUID, loginResult.token, appResult.sessionID, null);

        try {
            const userData = await getThisUserData();
            if (userData.result === 'SUCCESS') {
                saveSession(loginResult.UUID, loginResult.token, appResult.sessionID, userData.username);
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
        showLoginError('Ошибка соединения с сервером');
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

        showNotification('✅ Регистрация успешна! Теперь войдите.', 'success');

        // Переключаем на форму логина
        document.querySelectorAll('.auth-box').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.auth-box')[0].style.display = 'block';

        // Подставляем логин
        document.getElementById('loginUsername').value = username;
        document.getElementById('loginPassword').value = '';

        // Очищаем форму регистрации
        emailInput.value = '';
        usernameInput.value = '';
        passwordInput.value = '';
        phoneInput.value = '';
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        showSignupError('Ошибка соединения с сервером');
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

// --- WEBSOCKET ---
function setupWebSocketHandlers() {
    wsClient.on('chatsUpdate', (chats) => { renderChats(chats); });
    wsClient.on('chatOpened', (messages) => { renderMessages(messages); });
    wsClient.on('moreMessages', (oldMessages) => { renderMessages(oldMessages, true); });
    wsClient.on('newMessage', (message) => { addMessage(message); });

    wsClient.on('messageConfirmed', (data) => {
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

    wsClient.on('result', (data) => {
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