let sessionData = { uuid: null, token: null, sessionID: null, username: null };

export function saveSession(uuid, token, sessionID, username) {
    sessionData = { uuid, token, sessionID, username };
    try {
        sessionStorage.setItem('messenger_session', JSON.stringify(sessionData));
    } catch (e) { console.warn('Не удалось сохранить сессию:', e); }
}

export function loadSession() {
    try {
        const saved = sessionStorage.getItem('messenger_session');
        if (saved) { sessionData = JSON.parse(saved); return true; }
    } catch (e) { console.warn('Не удалось загрузить сессию:', e); }
    return false;
}

export function getSession() { return sessionData; }
export function getSessionID() { return sessionData.sessionID; }
export function getUUID() { return sessionData.uuid; }
export function getToken() { return sessionData.token; }
export function getUsername() { return sessionData.username; }

export function clearSession() {
    sessionData = { uuid: null, token: null, sessionID: null, username: null };
    try { sessionStorage.removeItem('messenger_session'); }
    catch (e) { console.warn('Не удалось очистить сессию:', e); }
}

export function isAuthenticated() { return !!sessionData.sessionID; }