import { CONFIG } from './config.js';
import { getSessionID } from './auth.js';

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimeout = null;
        this.pingInterval = null;
        
        // Очередь сообщений, если WS не открыт
        this.messageQueue = [];
        
        // Обработчики событий
        this.handlers = {
            chatsUpdate: [],
            chatOpened: [],
            newMessage: [],
            messageConfirmed: [],
            messageDeleted: [],
            messageEdited: [],
            connectionState: [],
            error: []
        };
    }

    // Подключение к WebSocket
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.warn('WebSocket уже подключается или открыт');
            return;
        }

        const sessionID = getSessionID();
        if (!sessionID) {
            console.error('Нет sessionID для подключения к WebSocket');
            this.trigger('error', new Error('Нет активной сессии'));
            return;
        }

        console.log('Подключение к WebSocket...');
        
        try {
            this.ws = new WebSocket(CONFIG.WS_URL);
            
            this.ws.onopen = () => {
                console.log('✅ WebSocket подключен');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                
                // Отправляем подтверждение сессии
                this.send({
                    action: 'CONFIRM',
                    sessionID: sessionID
                });
                
                // Запускаем пинг
                this.startPing();
                
                // Отправляем сообщения из очереди
                this.flushQueue();
                
                this.trigger('connectionState', true);
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Ошибка парсинга WS сообщения:', e);
                }
            };
            
            this.ws.onclose = (event) => {
                console.log(`❌ WebSocket отключен: ${event.code} - ${event.reason}`);
                this.isConnected = false;
                this.stopPing();
                this.trigger('connectionState', false);
                this.reconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket ошибка:', error);
                this.trigger('error', error);
            };
            
        } catch (e) {
            console.error('Ошибка создания WebSocket:', e);
            this.reconnect();
        }
    }

    // Переподключение
    reconnect() {
        if (this.reconnectTimeout) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Превышено количество попыток переподключения');
            this.trigger('error', new Error('Не удалось подключиться к серверу'));
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
        console.log(`🔄 Переподключение через ${Math.round(delay/1000)}с... (попытка ${this.reconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    // Отправка сообщения
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            return true;
        } else {
            // Если WS не открыт - добавляем в очередь
            console.warn('WebSocket не открыт, сообщение в очереди:', data);
            this.messageQueue.push(data);
            
            // Пытаемся переподключиться, если не в процессе
            if (!this.reconnectTimeout && !this.isConnected) {
                this.reconnect();
            }
            return false;
        }
    }

    // Отправка сообщений из очереди
    flushQueue() {
        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            this.send(msg);
        }
    }

    // Запуск пинга
    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.isConnected) {
                this.send({ type: 'PING' });
            }
        }, CONFIG.PING_INTERVAL || 30000);
    }

    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    // Обработка входящих сообщений
    handleMessage(data) {
        // PING от сервера
        if (data.type === 'PING') {
            this.send({
                type: 'PONG',
                timestamp: Date.now()
            });
            return;
        }

        // Список чатов (массив)
        if (Array.isArray(data)) {
            this.trigger('chatsUpdate', data);
            return;
        }

        // Открытие чата (сообщения + результат)
        if (data.messages && data.result !== undefined) {
            this.trigger('chatOpened', data.messages);
            return;
        }

        // Старые сообщения (при прокрутке)
        if (data.messages && data.messages.length > 0 && !data.result) {
            this.trigger('moreMessages', data.messages);
            return;
        }

        // Подтверждение localUUID -> realUUID
        if (data.localUUID && data.realUUID) {
            this.trigger('messageConfirmed', data);
            return;
        }

        // Новое сообщение
        if (data.action === 'SEND_MESSAGE' && data.message) {
            this.trigger('newMessage', data.message);
            return;
        }

        // Удаление сообщения
        if (data.action === 'DELETE' && data.messageUUID) {
            this.trigger('messageDeleted', data);
            return;
        }

        // Редактирование сообщения
        if (data.action === 'EDIT' && data.messageUUID) {
            this.trigger('messageEdited', data);
            return;
        }

        // Результат операции
        if (data.result) {
            console.log('Результат операции:', data);
            this.trigger('result', data);
            return;
        }

        console.log('⚠️ Неизвестное сообщение от сервера:', data);
    }

    // === ПУБЛИЧНЫЕ МЕТОДЫ ДЛЯ КЛИЕНТА ===

    // Подписка на события
    on(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event].push(handler);
        } else {
            console.warn(`Неизвестное событие: ${event}`);
        }
    }

    // Удаление подписки
    off(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(h => h !== handler);
        }
    }

    trigger(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => {
                try {
                    handler(data);
                } catch (e) {
                    console.error(`Ошибка в обработчике ${event}:`, e);
                }
            });
        }
    }

    // Действия пользователя
    openChat(chatUUID) {
        this.send({ action: 'OPEN_CHAT', UUID: chatUUID });
    }

    getMoreMessages() {
        this.send({ action: 'GET_MORE_OLD_MESSAGES' });
    }

    sendMessage(content, timestamp, localUUID) {
        this.send({
            action: 'SEND_MESSAGE',
            message: { content, timestamp, localUUID }
        });
    }

    deleteMessage(messageUUID) {
        this.send({ action: 'DELETE', messageUUID });
    }

    editMessage(messageUUID, newText) {
        this.send({ action: 'EDIT', messageUUID, newText });
    }

    // Закрытие соединения
    disconnect() {
        this.stopPing();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.messageQueue = [];
    }

    // Статус соединения
    getStatus() {
        if (!this.ws) return 'disconnected';
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'disconnected';
            default: return 'unknown';
        }
    }
}

// Создаем и экспортируем один экземпляр (Singleton)
export const wsClient = new WebSocketClient();