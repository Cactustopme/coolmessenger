import { CONFIG } from './config.js';
import { getSessionID } from './auth.js';

// Базовый URL для API
const API = CONFIG.API_BASE;

// Вспомогательная функция для запросов
async function request(endpoint, options = {}) {
    const url = `${API}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    // Добавляем sessionID если есть
    const sessionID = getSessionID();
    if (sessionID) {
        headers['Authorization'] = "Bearer " + sessionID;
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    // Парсим ответ
    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new Error('Неверный ответ от сервера');
    }

    // Проверяем результат
    if (data.result && data.result !== 'SUCCESS') {
        throw new Error(data.result);
    }

    return data;
}

// === АВТОРИЗАЦИЯ ===

export async function signup(email, username, password, phone = '') {
    const data = await request('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, password, phone })
    });
    return data; // { UUID, token, result }
}

export async function userLogin(username, password) {
    const data = await request('/userlogin', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    return data; // { UUID, token, result }
}

export async function appLogin(uuid, token) {
    const data = await request('/applogin', {
        method: 'POST',
        body: JSON.stringify({ UUID: uuid, token })
    });
    return data; // { sessionID, result }
}

// === ЧАТЫ ===

export async function newDirectChat(name, targetUUID) {
    return await request('/new_direct_chat', {
        method: 'POST',
        body: JSON.stringify({ name, targetUUID })
    });
}

export async function newGroupChat(name) {
    return await request('/new_group_chat', {
        method: 'POST',
        body: JSON.stringify({ name })
    });
}

export async function groupChatAdd(chatUUID, userUUID) {
    return await request('/group_chat_add', {
        method: 'POST',
        body: JSON.stringify({ chatUUID, userUUID })
    });
}

export async function chatEdit(chatUUID, newName, newDescription) {
    const body = { chatUUID };
    if (newName !== undefined) body.newName = newName;
    if (newDescription !== undefined) body.newDescription = newDescription;
    return await request('/chat_edit', {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

export async function deleteChat(chatUUID) {
    return await request('/delete_chat', {
        method: 'DELETE',
        body: JSON.stringify({ chatUUID })
    });
}

// === ПОЛЬЗОВАТЕЛИ ===

export async function searchUser(username) {
    return await request(`/getuser?username=${encodeURIComponent(username)}`);
}

export async function getUserData(uuid) {
    return await request(`/get_user_data?UUID=${uuid}`);
}

export async function getThisUserData() {
    return await request('/get_this_user_data');
}

export async function updateUser(data) {
    return await request('/update_user', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}