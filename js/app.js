// Главный файл приложения
import { CONFIG } from './config.js';
import { 
    signup, userLogin, appLogin, 
    getThisUserData 
} from './api.js';
import { 
    saveSession, loadSession, clearSession, 
    getSession, getUUID, isAuthenticated 
} from './auth.js';
import { wsClient } from './websocket.js';
import {
    initUI, showLoginPage, showChatPage,
    renderChats, renderMessages, addMessage, updateMessage,
    selectChat, setupInfiniteScroll,
    showNewChatDialog, logout,
    showLoginError, showSignupError
} from './ui.js';

// ===== ИНИЦИАЛИЗАЦИЯ =====

document.addEventListener('DOMContentLoaded', () => {
    // Инициализируем UI
    initUI();
    
    // Настраиваем обработчики
    setupEventListeners();
    
    // Настраиваем бесконечный скролл
    setupInfiniteScroll();
    
    // Настраиваем обработчики WebSocket
    setupWebSocketHandlers();
    
    // Проверяем, есть ли сохраненная сессия
    if (loadSession() && isAuthenticated()) {
        // Пробуем восстановить сессию
        restoreSession();
    } else {
        showLoginPage();
    }
});

// ===== ВОССТАНОВЛЕНИЕ СЕССИИ =====

async function restoreSession() {
    try {
        // Пробуем получить данные пользователя для проверки
        await getThisUserData();
        // Если успешно - подключаем WS
        wsClient.connect();
        showChatPage();
    } catch (error) {
        console.warn('Сессия недействительна, требуется вход');
        clearSession();
        showLoginPage();
    }
}

// ===== ОБРАБОТЧИКИ СОБЫТИЙ =====

function setupEventListeners() {
    // Логин
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    
    // Регистрация
    document.getElementById('signupForm')?.addEventListener('submit', handleSignup);
    
    // Переключение между формами
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
    
    // Отправка сообщения
    document.getElementById('sendButton')?.addEventListener('click', handleSendMessage);
    document.getElementById('messageInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    
    // Выход
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    
    // Новый чат
    document.getElementById('newChatBtn')?.addEventListener('click', showNewChatDialog);
}

// ===== ОБРАБОТЧИК ЛОГИНА =====

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showLoginError('Заполните все поля');
        return;
    }

    try {
        // Шаг 1: Получаем UUID и token
        const loginResult = await userLogin(username, password);
        if (loginResult.result !== 'SUCCESS') {
            showLoginError(loginResult.result || 'Ошибка входа');
            return;
        }

        // Шаг 2: Получаем sessionID
        const appResult = await appLogin(loginResult.UUID, loginResult.token);
        if (appResult.result !== 'SUCCESS') {
            showLoginError(appResult.result || 'Ошибка создания сессии');
            return;
        }

        // Шаг 3: Сохраняем сессию
        saveSession(
            loginResult.UUID, 
            loginResult.token, 
            appResult.sessionID,
            null // username получим позже
        );

        // Шаг 4: Получаем данные пользователя
        try {
            const userData = await getThisUserData();
            if (userData.result === 'SUCCESS') {
                saveSession(
                    loginResult.UUID,
                    loginResult.token,
                    appResult.sessionID,
                    userData.username
                );
            }
        } catch (e) {
            console.warn('Не удалось получить данные пользователя');
        }

        // Шаг 5: Подключаем WS
        wsClient.connect();
        showChatPage();
        
        // Очищаем форму
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';

    } catch (error) {
        console.error('Ошибка входа:', error);
        showLoginError('Ошибка соединения с сервером');
    }
}

// ===== ОБРАБОТЧИК РЕГИСТРАЦИИ =====

async function handleSignup(e) {
    e.preventDefault();
    
    const email = document.getElementById('signupEmail').value.trim();
    const username = document.getElementById('signupUsername').value.trim();
    const password = document.getElementById('signupPassword').value;
    const phone = document.getElementById('signupPhone').value.trim();

    if (!email || !username || !password) {
        showSignupError('Заполните все обязательные поля');
        return;
    }

    if (username.length < 3) {
        showSignupError('Имя пользователя должно быть не менее 3 символов');
        return;
    }

    if (password.length < 6) {
        showSignupError('Пароль должен быть не менее 6 символов');
        return;
    }

    try {
        const result = await signup(email, username, password, phone);
        if (result.result !== 'SUCCESS') {
            showSignupError(result.result || 'Ошибка регистрации');
            return;
        }

        alert('✅ Регистрация успешна! Теперь войдите в аккаунт.');
        
        // Переключаем на форму логина
        document.querySelectorAll('.auth-box').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.auth-box')[0].style.display = 'block';
        
        // Подставляем email
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = '';
        
        // Очищаем форму регистрации
        document.getElementById('signupEmail').value = '';
        document.getElementById('signupUsername').value = '';
        document.getElementById('signupPassword').value = '';
        document.getElementById('signupPhone').value = '';

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        showSignupError('Ошибка соединения с сервером');
    }
}

// ===== ОБРАБОТЧИК ОТПРАВКИ СООБЩЕНИЯ =====

function handleSendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content) return;

    const localUUID = crypto.randomUUID ? crypto.randomUUID() : 
        Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toISOString();

    // Отправляем через WS
    wsClient.sendMessage(content, timestamp, localUUID);

    // Добавляем в UI (оптимистично)
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

// ===== ОБРАБОТЧИКИ WEBSOCKET =====

function setupWebSocketHandlers() {
    // Обновление списка чатов
    wsClient.on('chatsUpdate', (chats) => {
        renderChats(chats);
    });

    // Открытие чата (первые 20 сообщений)
    wsClient.on('chatOpened', (messages) => {
        renderMessages(messages);
    });

    // Дополнительные старые сообщения
    wsClient.on('moreMessages', (oldMessages) => {
        renderMessages(oldMessages, true);
    });

    // Новое сообщение
    wsClient.on('newMessage', (message) => {
        addMessage(message);
    });

    // Подтверждение отправки (localUUID -> realUUID)
    wsClient.on('messageConfirmed', (data) => {
        // Обновляем сообщение в UI
        updateMessage(data.localUUID, { 
            UUID: data.realUUID, 
            isPending: false 
        });
    });

    // Удаление сообщения
    wsClient.on('messageDeleted', (data) => {
        updateMessage(data.messageUUID, { content: '🗑️ Сообщение удалено' });
    });

    // Редактирование сообщения
    wsClient.on('messageEdited', (data) => {
        updateMessage(data.messageUUID, { content: data.newText });
    });

    // Статус соединения
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

    // Ошибки
    wsClient.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
        // Можно показать уведомление пользователю
    });

    // Результаты операций
    wsClient.on('result', (data) => {
        if (data.result === 'SUCCESS') {
            console.log('Операция успешна');
        } else {
            console.warn('Операция вернула ошибку:', data.result);
        }
    });
}

// ===== ОБРАБОТКА ПЕРЕЗАГРУЗКИ СТРАНИЦЫ =====

window.addEventListener('beforeunload', () => {
    // Отключаем WS корректно
    wsClient.disconnect();
});

// ===== ДОПОЛНИТЕЛЬНО: АВТО-РЕСАЙЗ TEXTAREA =====

document.addEventListener('input', (e) => {
    if (e.target.id === 'messageInput') {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    }
});

// Делаем функции глобальными для inline обработчиков
window.selectChat = selectChat;
window.showNewChatDialog = showNewChatDialog;
window.logout = logout;

console.log('🚀 Cool Messenger приложение загружено!');
console.log(`📡 API: ${CONFIG.API_BASE}`);
console.log(`🔌 WS: ${CONFIG.WS_URL}`);