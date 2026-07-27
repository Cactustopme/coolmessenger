// Конфигурация приложения
export const CONFIG = {
    // URL API сервера (заменишь, когда друг скажет IP)
    API_BASE: 'http://localhost:8080',
    // Или для теста локально: 'http://localhost:8080'
    
    WS_URL: 'ws://localhost:8080/ws',
    // Или: 'ws://localhost:8080/ws'
    
    // Лимиты
    MAX_MESSAGE_LENGTH: 5000,
    MAX_USERNAME_LENGTH: 30,
    MAX_CHAT_NAME_LENGTH: 50,
    
    // Таймауты
    RECONNECT_TIMEOUT: 3000,
    PING_INTERVAL: 30000,
};