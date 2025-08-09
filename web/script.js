// Основной класс приложения чата
class ChatApp {
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
        this.loadFromStorage();
        this.showConnectionForm();
    }

    bindEvents() {
        // Кнопки формы подключения
        document.getElementById('joinBtn').addEventListener('click', () => this.joinRoom());
        document.getElementById('createRoomBtn').addEventListener('click', () => this.showCreateRoomModal());
        
        // Кнопки чата
        document.getElementById('leaveBtn').addEventListener('click', () => this.leaveRoom());
        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
        
        // Кнопки модального окна
        document.getElementById('newRoomBtn').addEventListener('click', () => this.showCreateRoomModal());
        document.getElementById('closeModalBtn').addEventListener('click', () => this.hideCreateRoomModal());
        document.getElementById('copyRoomIdBtn').addEventListener('click', () => this.copyRoomId());
        document.getElementById('joinNewRoomBtn').addEventListener('click', () => this.joinNewRoom());
        
        // Обработка Enter в полях ввода
        document.getElementById('roomId').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Обработка закрытия страницы
        window.addEventListener('beforeunload', () => {
            if (this.isConnected) {
                this.disconnect();
            }
        });
    }

    loadFromStorage() {
        this.username = localStorage.getItem('chatters_username') || '';
        if (this.username) {
            document.getElementById('username').value = this.username;
        }
    }

    saveToStorage() {
        if (this.username) {
            localStorage.setItem('chatters_username', this.username);
        }
    }

    showConnectionForm() {
        document.getElementById('connectionForm').classList.remove('hidden');
        document.getElementById('chatRoom').classList.add('hidden');
    }

    showChatRoom() {
        document.getElementById('connectionForm').classList.add('hidden');
        document.getElementById('chatRoom').classList.remove('hidden');
        document.getElementById('messageInput').focus();
    }

    showCreateRoomModal() {
        document.getElementById('createRoomModal').classList.remove('hidden');
        this.createRoom();
    }

    hideCreateRoomModal() {
        document.getElementById('createRoomModal').classList.add('hidden');
    }

    async createRoom() {
        try {
            const response = await fetch('http://localhost:8080/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('newRoomId').textContent = data.room_id;
                this.showNotification('Комната создана!', `ID: ${data.room_id}`, 'success');
            } else {
                const error = await response.json();
                this.showNotification('Ошибка', error.error || 'Не удалось создать комнату', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка', 'Не удалось подключиться к серверу', 'error');
        }
    }

    copyRoomId() {
        const roomId = document.getElementById('newRoomId').textContent;
        navigator.clipboard.writeText(roomId).then(() => {
            this.showNotification('Скопировано!', 'ID комнаты скопирован в буфер обмена', 'success');
        }).catch(() => {
            this.showNotification('Ошибка', 'Не удалось скопировать ID', 'error');
        });
    }

    joinNewRoom() {
        const roomId = document.getElementById('newRoomId').textContent;
        if (roomId && roomId !== '...') {
            document.getElementById('roomId').value = roomId;
            this.hideCreateRoomModal();
            this.showConnectionForm();
        }
    }

    async joinRoom() {
        const roomId = document.getElementById('roomId').value.trim();
        const username = document.getElementById('username').value.trim();

        if (!roomId || !username) {
            this.showNotification('Ошибка', 'Заполните все поля', 'error');
            return;
        }

        if (username.length > 20) {
            this.showNotification('Ошибка', 'Имя пользователя слишком длинное', 'error');
            return;
        }

        this.username = username;
        this.saveToStorage();

        try {
            // Проверяем существование комнаты
            const response = await fetch(`http://localhost:8080/rooms/${roomId}`);
            if (!response.ok) {
                this.showNotification('Ошибка', 'Комната не найдена', 'error');
                return;
            }

            this.currentRoom = roomId;
            this.connectWebSocket(roomId, username);
            
        } catch (error) {
            this.showNotification('Ошибка', 'Не удалось подключиться к серверу', 'error');
        }
    }

    connectWebSocket(roomId, username) {
        const wsUrl = `ws://localhost:8080/ws/${roomId}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.showChatRoom();
            document.getElementById('currentRoomId').textContent = roomId;
            
            // Отправляем информацию о пользователе
            this.ws.send(JSON.stringify({
                type: 'join',
                data: { username: username }
            }));
            
            this.showNotification('Подключено!', `Вы присоединились к комнате #${roomId}`, 'success');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('Ошибка парсинга сообщения:', error);
            }
        };

        this.ws.onclose = (event) => {
            this.isConnected = false;
            if (!event.wasClean) {
                this.handleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
            this.showNotification('Ошибка', 'Ошибка подключения к чату', 'error');
        };
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.showNotification('Переподключение...', `Попытка ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'info');
            
            setTimeout(() => {
                if (this.currentRoom && this.username) {
                    this.connectWebSocket(this.currentRoom, this.username);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.showNotification('Ошибка', 'Не удалось переподключиться. Проверьте соединение.', 'error');
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
                this.showNotification('Ошибка', message.data.message, 'error');
                break;
            default:
                console.log('Неизвестный тип сообщения:', message);
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
            this.showNotification('Ошибка', 'Сообщение слишком длинное', 'error');
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
        
        // Очищаем сообщения
        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('messageInput').value = '';
        
        this.showConnectionForm();
        this.showNotification('Информация', 'Вы покинули чат', 'info');
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Page unload');
        }
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

    showNotification(title, message, type = 'info') {
        const notificationsContainer = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = this.getNotificationIcon(type);
        
        notification.innerHTML = `
            <div class="notification-content">
                <i class="notification-icon ${icon}"></i>
                <div class="notification-text">
                    <div class="notification-title">${title}</div>
                    <div class="notification-message">${message}</div>
                </div>
            </div>
        `;
        
        notificationsContainer.appendChild(notification);
        
        // Автоматически удаляем уведомление через 5 секунд
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 5000);
    }

    getNotificationIcon(type) {
        switch (type) {
            case 'success':
                return 'fas fa-check-circle';
            case 'error':
                return 'fas fa-exclamation-circle';
            case 'info':
                return 'fas fa-info-circle';
            default:
                return 'fas fa-info-circle';
        }
    }
}

// Инициализация приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});

// Обработка ошибок
window.addEventListener('error', (event) => {
    console.error('Глобальная ошибка:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Необработанное отклонение промиса:', event.reason);
}); 