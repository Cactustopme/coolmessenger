import { CONFIG } from './config.js';
import { getSessionID } from './auth.js';

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = CONFIG.MAX_RECONNECT_ATTEMPTS_BEFORE_REFRESH;
        this.reconnectTimeout = null;
        this.pingInterval = null;
        this.messageQueue = [];
        this.handlers = {
            chatsUpdate: [], chatOpened: [], newMessage: [],
            messageConfirmed: [], messageDeleted: [], messageEdited: [],
            connectionState: [], error: [], result : [], moreMessages: [],
            ping: [], sessionExpired: [], userStatusChanged: []
        };
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        this.shouldReconnect = true;
        const sessionID = getSessionID();
        if (!sessionID) {
            console.error('Нет sessionID для подключения');
            this.trigger('error', new Error('Нет активной сессии'));
            return;
        }
        try {
            this.ws = new WebSocket(CONFIG.WS_URL);
            this.ws.onopen = () => {
                console.log('✅ WebSocket подключен');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('[WS][AUTH] Отправка CONFIRM с текущей sessionID', {
                    hasSessionID: Boolean(sessionID)
                });
                const confirmSent = this.send({ action: 'CONFIRM', sessionID });
                console.log('[WS][AUTH] CONFIRM отправлен:', confirmSent);
                this.startPing();
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
            this.ws.onclose = () => {
                console.log('❌ WebSocket отключен');
                console.log('[WS][AUTH] Соединение закрыто', {
                    reconnectEnabled: this.shouldReconnect
                });
                this.isConnected = false;
                this.stopPing();
                this.trigger('connectionState', false);
                if (this.shouldReconnect) this.reconnect();
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

    reconnect() {
        if (this.reconnectTimeout) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('⚠️ Не удалось переподключиться, требуется обновление сессии');
            this.trigger('sessionExpired', { reason: 'RECONNECT_ATTEMPTS_EXCEEDED' });
            return;
        }
        this.reconnectAttempts++;
        const delay = CONFIG.RECONNECT_TIMEOUT;
        console.log(`🔄 Переподключение через ${delay}мс... (попытка ${this.reconnectAttempts})`);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            return true;
        } else {
            this.messageQueue.push(data);
            if (!this.reconnectTimeout && !this.isConnected) this.reconnect();
            return false;
        }
    }

    flushQueue() {
        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            this.send(msg);
        }
    }

    startPing() {
        //this.stopPing();
        //this.pingInterval = setInterval(() => {
            //if (this.isConnected) this.send({ type: 'PING' });
        //}, CONFIG.PING_INTERVAL || 30000);
    }

    stopPing() {
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    }

    handleMessage(data) {
        if (data.type === 'PING') {
            this.trigger('ping', null)
            return;
        }

        if (data.type === 'SESSION_EXPIRED') {
            console.warn('[WS][AUTH] Получено SESSION_EXPIRED от сервера');
            this.trigger('sessionExpired', data);
            return;
        }

        console.log(data)

        // Список чатов (массив)
        if (data.type === "CHAT_ARRAY_APPEND" || data.type === "CHAT_ARRAY_REPLACE") {
            this.trigger('chatsUpdate', data.chats);
            return;
        }

        // Открытие чата (сообщения + результат)
        if (data.type === "MESSAGE_ARRAY" && data.source === "CHAT_OPENED") {
            console.log("Chat opened!!!")
            this.trigger('chatOpened', data.messages);
            return;
        }

        // Старые сообщения (при прокрутке)
        if (data.type === "MESSAGE_ARRAY" && data.source === "OLD_MESSAGES_REQUESTED") {
            console.log("Old messages (1)")
            this.trigger('moreMessages', data.messages);
            return;
        }

        // Подтверждение localUUID -> realUUID
        if (data.type === "INCOMING_MESSAGE_CONFIRMED") {
            this.trigger('messageConfirmed', data);
            return;
        }

        if (data.type === 'USER_STATUS_CHANGED') {
            console.info('[STATUS][RECEIVE] Получено обновление статуса', {
                userID: data.userID || data.userId || data.userUUID || data.UUID || data.id,
                active: data.active ?? data.member?.active ?? data.user?.active,
                typing: data.typing ?? data.member?.typing ?? data.user?.typing,
                data
            });
            this.trigger('userStatusChanged', data);
            return;
        }

        // Новое сообщение
        if (data.type === "MESSAGE_ARRAY" && data.source === "MESSAGE_SENT_BY_CHAT_MEMBER") {
            console.log("Message received!")
            this.trigger('newMessage', data);
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

    on(event, handler) {
        if (this.handlers[event]) this.handlers[event].push(handler);
        else console.warn(`Неизвестное событие: ${event}`);
    }

    off(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(h => h !== handler);
        }
    }

    trigger(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => {
                try { handler(data); }
                catch (e) { console.error(`Ошибка в обработчике ${event}:`, e); }
            });
        } else {
            console.error("No handler available for: " + event)
        }
    }

    openChat(chatUUID) { this.send({ action: 'OPEN_CHAT', UUID: chatUUID }); }

    getMoreMessages(oldestMessageTime) {
        this.send({
            action: 'GET_MORE_OLD_MESSAGES',
            oldestMessageTimestamp: oldestMessageTime
        });
    }
    sendMessage(content, timestamp, localUUID) {
        this.send({ action: 'SEND_MESSAGE', message: { content, timestamp, localUUID } });
    }
    deleteMessage(messageUUID) { this.send({ action: 'DELETE', messageUUID }); }
    editMessage(messageUUID, newText) { this.send({ action: 'EDIT', messageUUID, newText }); }
    disconnect() {
        this.shouldReconnect = false;
        this.stopPing();
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.isConnected = false;
        this.messageQueue = [];
    }

    reconnectWithSession() {
        if (this.ws && (
            this.ws.readyState === WebSocket.OPEN ||
            this.ws.readyState === WebSocket.CONNECTING
        )) {
            console.log('[WS][AUTH] Сессия обновлена, заменяю WebSocket');
            this.shouldReconnect = false;
            this.stopPing();
            this.isConnected = false;
            this.ws.close(4001, 'Session refreshed');
            this.ws = null;
        }

        this.shouldReconnect = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.reconnectAttempts = 0;
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, CONFIG.SESSION_RECONNECT_TIMEOUT);
    }
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

export const wsClient = new WebSocketClient();