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
        this.messageQueue = [];
        this.handlers = {
            chatsUpdate: [], chatOpened: [], newMessage: [],
            messageConfirmed: [], messageDeleted: [], messageEdited: [],
            connectionState: [], error: [], result : [], moreMessages: [],
            ping: []
        };
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
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
                this.send({ action: 'CONFIRM', sessionID });
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
        this.stopPing();
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        if (this.ws) { this.ws.close(); this.ws = null; }
        this.isConnected = false;
        this.messageQueue = [];
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