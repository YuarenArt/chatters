// Chat widget logic
class ChatWidget {
    constructor() {
        this.ws = null;
        this.currentRoom = null;
        this.username = '';
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('leaveBtn').addEventListener('click', () => this.leaveRoom());
        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());

        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    }

    joinRoom(roomId, username) {
        this.currentRoom = roomId;
        this.username = username;
        this.connectWebSocket(roomId, username);
    }

    connectWebSocket(roomId, username) {
        const wsUrl = `${WS_BASE_URL}/${roomId}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.showChatRoom();
            document.getElementById('currentRoomId').textContent = roomId;

            this.ws.send(JSON.stringify({
                type: 'join',
                data: { username: username }
            }));

            window.chatApp.showNotification('Подключено!', `Вы присоединились к комнате #${roomId}`, 'success');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        this.ws.onclose = (event) => {
            this.isConnected = false;
            if (!event.wasClean) {
                this.handleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            window.chatApp.showNotification('Ошибка', 'Ошибка подключения к чату', 'error');
        };
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            window.chatApp.showNotification('Переподключение...', `Попытка ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'info');

            setTimeout(() => {
                if (this.currentRoom && this.username) {
                    this.connectWebSocket(this.currentRoom, this.username);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            window.chatApp.showNotification('Ошибка', 'Не удалось переподключиться. Проверьте соединение.', 'error');
            this.leaveRoom();
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'chat':
                this.addChatMessage(message.data);
                break;
            case 'join':
                this.addSystemMessage(`${message.data.username} присоединился к чату`);
                this.updateOnlineCount(message.data.onlineCount);
                break;
            case 'leave':
                this.addSystemMessage(`${message.data.username} покинул чат`);
                this.updateOnlineCount(message.data.onlineCount);
                break;
            case 'error':
                window.chatApp.showNotification('Ошибка', message.data.message, 'error');
                break;
            default:
                console.log('Unknown message type:', message);
        }
    }

    addChatMessage(data) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.username === this.username ? 'own' : ''}`;

        const timestamp = new Date().toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <span class="username">${this.escapeHtml(data.username)}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="message-text">${this.escapeHtml(data.text)}</div>
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSystemMessage(text) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = text;

        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    updateOnlineCount(count) {
        document.getElementById('onlineCount').textContent = count || 0;
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();

        if (!text || !this.isConnected) return;

        if (text.length > 1000) {
            window.chatApp.showNotification('Ошибка', 'Сообщение слишком длинное', 'error');
            return;
        }

        const message = {
            type: 'chat',
            data: { text: text }
        };

        this.ws.send(JSON.stringify(message));
        input.value = '';
    }

    leaveRoom() {
        if (this.ws) {
            this.ws.close(1000, 'User left');
        }

        this.isConnected = false;
        this.currentRoom = null;
        this.reconnectAttempts = 0;

        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('messageInput').value = '';

        window.chatApp.showConnectionForm();
        window.chatApp.showNotification('Информация', 'Вы покинули чат', 'info');
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Page unload');
        }
    }

    showChatRoom() {
        document.getElementById('connectionForm').classList.add('hidden');
        document.getElementById('chatRoom').classList.remove('hidden');
        document.getElementById('messageInput').focus();
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Expose widget globally
window.chatWidget = new ChatWidget();