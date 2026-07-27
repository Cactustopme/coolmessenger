// Генерация UUID для временных сообщений
export function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

// Форматирование времени
export function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

export function formatFullDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Экранирование HTML (защита от XSS)
export function escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обработка ошибок с сервера
export function handleApiError(result) {
    const errors = {
        'REQUEST_INVALID': 'Неверный запрос',
        'SESSION_ALREADY_ACTIVE': 'Сессия уже активна',
        'CHAT_INVALID': 'Чат не найден',
        'NOT_ENOUGH_RIGHTS': 'Недостаточно прав',
        'SESSION_INVALID': 'Сессия недействительна',
        'INTERNAL_ERROR': 'Внутренняя ошибка сервера',
        'UUID_TOKEN_INVALID': 'Неверный токен',
        'LOGIN_PASSWORD_INCORRECT': 'Неверный логин или пароль'
    };
    return errors[result] || 'Неизвестная ошибка';
}