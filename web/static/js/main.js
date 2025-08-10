// Main application entry point

const API_BASE_URL = 'http://localhost:8080/api';
const WS_BASE_URL = 'ws://localhost:8080/api/ws';

class ChatApp {
    constructor() {
        this.init();
    }

    async init() {
        // Load chat widget
        await this.loadChatWidget();
        // Load create room widget
        await this.loadCreateRoomWidget();
        // Initialize event listeners for main app
        this.bindMainEvents();
        // Load username from storage
        this.loadFromStorage();
        // Show connection form by default
        this.showConnectionForm();
    }

    async loadChatWidget() {
        // Load chat HTML
        const chatResponse = await fetch('/static/templates/chat.html');
        document.getElementById('chatRoom').outerHTML = await chatResponse.text();

        // Load chat JS
        const chatScript = document.createElement('script');
        chatScript.src = '/static/js/chat.js';
        document.body.appendChild(chatScript);
    }

    async loadCreateRoomWidget() {
        // Load create room HTML
        const createRoomResponse = await fetch('/static/templates/create-room.html');
        document.getElementById('createRoomModal').outerHTML = await createRoomResponse.text();

        // Load create room JS
        const createRoomScript = document.createElement('script');
        createRoomScript.src = '/static/js/create-room.js';
        document.body.appendChild(createRoomScript);
    }

    bindMainEvents() {
        document.getElementById('joinBtn').addEventListener('click', () => this.joinRoom());
        document.getElementById('createRoomBtn').addEventListener('click', () => window.createRoomWidget.showCreateRoomModal());
        document.getElementById('newRoomBtn').addEventListener('click', () => window.createRoomWidget.showCreateRoomModal());

        document.getElementById('roomId').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        window.addEventListener('beforeunload', () => {
            if (window.chatWidget.isConnected) {
                window.chatWidget.disconnect();
            }
        });
    }

    loadFromStorage() {
        const username = localStorage.getItem('chatters_username') || '';
        if (username) {
            document.getElementById('username').value = username;
        }
    }

    saveToStorage(username) {
        if (username) {
            localStorage.setItem('chatters_username', username);
        }
    }

    showConnectionForm() {
        document.getElementById('connectionForm').classList.remove('hidden');
        document.getElementById('chatRoom').classList.add('hidden');
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

        this.saveToStorage(username);

        try {
            const response = await fetch(`${API_BASE_URL}/rooms/${roomId}`);
            if (!response.ok) {
                this.showNotification('Ошибка', 'Комната не найдена', 'error');
                return;
            }

            window.chatWidget.joinRoom(roomId, username);
        } catch (error) {
            this.showNotification('Ошибка', 'Не удалось подключиться к серверу', 'error');
        }
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

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});

// Error handling
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});