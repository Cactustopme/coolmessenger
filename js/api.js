import { CONFIG } from './config.js';
import { getSessionID } from './auth.js';

const API = CONFIG.API_BASE;

async function request(endpoint, options = {}) {
    const url = `${API}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    const sessionID = getSessionID();
    if (sessionID) {
        headers['Authorization'] = sessionID;
    }

    const response = await fetch(url, { ...options, headers });
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error('Неверный ответ от сервера');
    }

    if (data && typeof data === 'object' && 'result' in data && data.result && data.result !== 'SUCCESS') {
        throw new Error(data.result);
    }

    return data;
}

export async function signup(email, username, password, phone = '') {
    return await request('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, password, phone })
    });
}

export async function userLogin(username, password) {
    return await request('/userlogin', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
}

export async function isSessionValid() {
    return await request('/is_session_valid', { method: 'GET' });
}

export async function refreshSession(deviceID, refreshToken) {
    return await request('/refresh_session', {
        method: 'POST',
        body: JSON.stringify({ deviceID, refreshToken })
    });
}

export async function newDirectChat(targetUUID) {
    return await request('/new_direct_chat', {
        method: 'POST',
        body: JSON.stringify({ targetUUID })
    });
}

export async function newGroupChat(name) {
    return await request('/new_group_chat', {
        method: 'POST',
        body: JSON.stringify({ name })
    });
}

export async function searchUser(username) {
    return await request(`/getuser?username=${encodeURIComponent(username)}`, {
        method: 'GET'
    });
}

export async function getUserData(uuid) {
    return await request(`/get_user_data?UUID=${uuid}`);
}

export async function getThisUserData() {
    return await request('/get_this_user_data');
}