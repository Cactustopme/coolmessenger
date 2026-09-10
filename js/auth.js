let sessionData = {
    uuid: null,
    token: null,
    sessionID: null,
    refreshToken: null,
    deviceID: null,
    username: null
};

const PERSISTENT_AUTH_KEY = 'messenger_auth';
const LEGACY_CREDS_KEY = 'messenger_credentials';
const TEMP_SESSION_KEY = 'messenger_session';

export function saveCredentials(uuid, token, refreshToken = null, deviceID = null) {
    try {
        const authData = {
            uuid,
            token,
            refreshToken,
            deviceID,
            sessionID: sessionData.sessionID,
            username: sessionData.username
        };
        localStorage.setItem(PERSISTENT_AUTH_KEY, JSON.stringify(authData));
        localStorage.setItem(LEGACY_CREDS_KEY, JSON.stringify({ uuid, token }));
    } catch (e) { console.warn('Не удалось сохранить учетные данные:', e); }
}

export function loadCredentials() {
    try {
        const saved = localStorage.getItem(PERSISTENT_AUTH_KEY) || localStorage.getItem(LEGACY_CREDS_KEY);
        if (saved) {
            const creds = JSON.parse(saved);
            if (creds && typeof creds === 'object') {
                return {
                    uuid: creds.uuid ?? null,
                    token: creds.token ?? null,
                    refreshToken: creds.refreshToken ?? null,
                    deviceID: creds.deviceID ?? null,
                    sessionID: creds.sessionID ?? null,
                    username: creds.username ?? null
                };
            }
        }
    } catch (e) { console.warn('Не удалось загрузить учетные данные:', e); }
    return null;
}

export function clearCredentials() {
    try {
        localStorage.removeItem(PERSISTENT_AUTH_KEY);
        localStorage.removeItem(LEGACY_CREDS_KEY);
    } catch (e) { console.warn('Не удалось очистить учетные данные:', e); }
}

export function saveSession(payloadOrUuid, tokenOrSessionID, sessionIDOrUsername, username) {
    const data = typeof payloadOrUuid === 'object' && payloadOrUuid !== null
        ? payloadOrUuid
        : {
            uuid: payloadOrUuid,
            token: tokenOrSessionID,
            sessionID: sessionIDOrUsername,
            username
        };

    sessionData = {
        uuid: data.uuid ?? null,
        token: data.token ?? null,
        sessionID: data.sessionID ?? null,
        refreshToken: data.refreshToken ?? null,
        deviceID: data.deviceID ?? null,
        username: data.username ?? null
    };

    if (sessionData.uuid || sessionData.refreshToken || sessionData.deviceID || sessionData.sessionID) {
        saveCredentials(sessionData.uuid, sessionData.token, sessionData.refreshToken, sessionData.deviceID);
    }

    try {
        sessionStorage.setItem(TEMP_SESSION_KEY, JSON.stringify({
            sessionID: sessionData.sessionID,
            username: sessionData.username
        }));
    } catch (e) { console.warn('Не удалось сохранить сессию:', e); }
}

export function loadSession() {
    try {
        const saved = sessionStorage.getItem(TEMP_SESSION_KEY);
        if (saved) {
            const tempData = JSON.parse(saved);
            const creds = loadCredentials();
            if (creds) {
                sessionData = {
                    uuid: creds.uuid ?? null,
                    token: creds.token ?? null,
                    sessionID: tempData.sessionID ?? creds.sessionID ?? null,
                    refreshToken: creds.refreshToken ?? null,
                    deviceID: creds.deviceID ?? null,
                    username: tempData.username ?? creds.username ?? null
                };
                return true;
            }
        }
    } catch (e) { console.warn('Не удалось загрузить сессию:', e); }
    return false;
}

export function getSession() { return sessionData; }
export function getSessionID() { return sessionData.sessionID; }
export function getUUID() { return sessionData.uuid; }
export function getToken() { return sessionData.token; }
export function getUsername() { return sessionData.username; }
export function getRefreshToken() { return sessionData.refreshToken; }
export function getDeviceID() { return sessionData.deviceID; }

export function clearSession() {
    sessionData = {
        uuid: null,
        token: null,
        sessionID: null,
        refreshToken: null,
        deviceID: null,
        username: null
    };
    try { sessionStorage.removeItem(TEMP_SESSION_KEY); }
    catch (e) { console.warn('Не удалось очистить сессию:', e); }
    clearCredentials();
}

export function isAuthenticated() { return !!sessionData.sessionID; }