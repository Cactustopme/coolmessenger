let sessionData = {
    uuid: null,
    token: null,
    sessionID: null,
    refreshToken: null,
    deviceID: null,
    username: null
};

const COOKIE_PREFIX = 'coolmessenger_';
const SESSION_MAX_AGE = 20 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

function cookieOptions(maxAge) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function setCookie(name, value, maxAge) {
    if (value === null || value === undefined || value === '') {
        document.cookie = `${COOKIE_PREFIX}${name}=; Path=/; Max-Age=0; SameSite=Lax`;
        return;
    }

    document.cookie = `${COOKIE_PREFIX}${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`;
}

function getCookie(name) {
    const prefix = `${COOKIE_PREFIX}${name}=`;
    const cookie = document.cookie
        .split('; ')
        .find(value => value.startsWith(prefix));

    if (!cookie) return null;

    try {
        return decodeURIComponent(cookie.slice(prefix.length));
    } catch (error) {
        console.warn(`[AUTH] Не удалось прочитать cookie ${name}`, error);
        return null;
    }
}

function deleteCookie(name) {
    setCookie(name, null, 0);
}

export function saveCredentials(uuid, token, refreshToken = null, deviceID = null) {
    setCookie('uuid', uuid, REFRESH_MAX_AGE);
    setCookie('token', token, REFRESH_MAX_AGE);
    setCookie('refreshToken', refreshToken, REFRESH_MAX_AGE);
    setCookie('deviceID', deviceID, REFRESH_MAX_AGE);
}

export function loadCredentials() {
    const refreshToken = getCookie('refreshToken');
    const deviceID = getCookie('deviceID');

    if (!refreshToken && !deviceID && !getCookie('sessionID')) {
        return null;
    }

    return {
        uuid: getCookie('uuid'),
        token: getCookie('token'),
        refreshToken,
        deviceID,
        sessionID: getCookie('sessionID'),
        username: getCookie('username')
    };
}

export function clearCredentials() {
    [
        'uuid',
        'token',
        'sessionID',
        'refreshToken',
        'deviceID',
        'username'
    ].forEach(deleteCookie);
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

    console.log('[AUTH] Сохраняю данные сессии', {
        hasSessionID: Boolean(sessionData.sessionID),
        hasRefreshToken: Boolean(sessionData.refreshToken),
        hasDeviceID: Boolean(sessionData.deviceID),
        refreshTokenChanged: sessionData.refreshToken !== getCookie('refreshToken')
    });

    setCookie('uuid', sessionData.uuid, REFRESH_MAX_AGE);
    setCookie('token', sessionData.token, REFRESH_MAX_AGE);
    setCookie('sessionID', sessionData.sessionID, SESSION_MAX_AGE);
    setCookie('refreshToken', sessionData.refreshToken, REFRESH_MAX_AGE);
    setCookie('deviceID', sessionData.deviceID, REFRESH_MAX_AGE);
    setCookie('username', sessionData.username, SESSION_MAX_AGE);

    console.log('[AUTH] Cookies сессии обновлены', {
        hasSessionCookie: Boolean(getCookie('sessionID')),
        hasRefreshTokenCookie: Boolean(getCookie('refreshToken')),
        refreshTokenSaved: getCookie('refreshToken') === sessionData.refreshToken
    });
}

export function loadSession() {
    const saved = loadCredentials();
    if (!saved) {
        return false;
    }

    sessionData = {
        uuid: saved.uuid,
        token: saved.token,
        sessionID: saved.sessionID,
        refreshToken: saved.refreshToken,
        deviceID: saved.deviceID,
        username: saved.username
    };

    return Boolean(
        sessionData.sessionID ||
        (sessionData.refreshToken && sessionData.deviceID)
    );
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
    clearCredentials();
}

export function isAuthenticated() {
    return Boolean(sessionData.sessionID);
}
