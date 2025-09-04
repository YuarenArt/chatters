
class ChatApp {
    constructor() {
        this.isInitialized = false;
        this.widgets = {};
        this.isJoining = false; // Track joining state
        this.init();
    }

    async init() {
        try {
            console.log('Initializing ChatApp...');

            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                });
            }

            await this.initializeWidgets();

            this.bindMainEvents();
            this.loadFromStorage();
            this.showConnectionForm();

            this.isInitialized = true;
            console.log('ChatApp successfully initialized');

        } catch (error) {
            console.error('ChatApp initialization error:', error);
            this.showNotification('Error', 'Failed to start application', 'error');
        }
    }

    async initializeWidgets() {
        try {
            await this.waitForWidgets();

            if (typeof CreateRoomWidget === 'function' && !this.widgets.createRoom) {
                this.widgets.createRoom = new CreateRoomWidget();
                console.log('CreateRoomWidget created');
            } else if (this.widgets.createRoom) {
                console.log('CreateRoomWidget already exists');
            }

            if (typeof ChatWidget === 'function' && !this.widgets.chat) {
                this.widgets.chat = new ChatWidget();
                console.log('ChatWidget created');
            } else if (this.widgets.chat) {
                console.log('ChatWidget already exists');
            }

            if (window.ChattersApp) {
                window.ChattersApp.widgets = this.widgets;
            }

        } catch (error) {
            console.error('Widget initialization error:', error);
            throw error;
        }
    }

    async waitForWidgets(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Widgets not loaded within ' + timeout + 'ms'));
            }, timeout);

            const checkWidgets = () => {
                if (typeof CreateRoomWidget === 'function' && typeof ChatWidget === 'function') {
                    clearTimeout(timeoutId);
                    resolve();
                } else {
                    setTimeout(checkWidgets, 100);
                }
            };

            checkWidgets();
        });
    }

    bindMainEvents() {
        try {
            const debouncedJoinRoom = debounce(() => this.joinRoom(), 500);

            this.bindElementEvent('joinBtn', 'click', debouncedJoinRoom);
            this.bindElementEvent('createRoomBtn', 'click', () => this.showCreateRoomModal());
            this.bindElementEvent('newRoomBtn', 'click', () => this.showCreateRoomModal());

            this.bindElementEvent('roomId', 'keypress', (e) => {
                if (e.key === 'Enter') debouncedJoinRoom();
            });

            this.bindElementEvent('username', 'keypress', (e) => {
                if (e.key === 'Enter') debouncedJoinRoom();
            });

            console.log('Main events bound');

        } catch (error) {
            console.error('Error binding main events:', error);
        }
    }

    bindElementEvent(elementId, eventType, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener(eventType, handler);
        } else {
            console.warn(`Element #${elementId} not found for event ${eventType}`);
        }
    }

    loadFromStorage() {
        try {
            const username = localStorage.getItem('chatters_username') || '';
            if (username) {
                const usernameInput = document.getElementById('username');
                if (usernameInput) {
                    usernameInput.value = username;
                }
            }
            console.log('Storage data loaded');
        } catch (error) {
            console.warn('Failed to load storage data:', error);
        }
    }

    saveToStorage(username) {
        try {
            if (username) {
                localStorage.setItem('chatters_username', username);
            }
        } catch (error) {
            console.warn('Failed to save storage data:', error);
        }
    }

    showConnectionForm() {
        try {
            const connectionForm = document.getElementById('connectionForm');
            const chatRoom = document.getElementById('chatRoom');

            if (connectionForm) connectionForm.classList.remove('hidden');
            if (chatRoom) chatRoom.classList.add('hidden');
        } catch (error) {
            console.error('Error showing connection form:', error);
        }
    }

    showCreateRoomModal() {
        try {
            if (this.widgets.createRoom) {
                this.widgets.createRoom.showCreateRoomModal();
            } else {
                console.error('CreateRoomWidget not initialized');
            }
        } catch (error) {
            console.error('Error showing create room modal:', error);
        }
    }

    async joinRoom() {
        if (this.isJoining) {
            console.log('Join attempt ignored: already joining');
            return;
        }

        this.isJoining = true;
        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) joinBtn.disabled = true;

        try {
            const roomId = this.getElementValue('roomId');
            const username = this.getElementValue('username');
            const password = this.getElementValue('roomPassword');

            if (!roomId || !username) {
                this.showNotification('Error', 'Please fill in all fields', 'error');
                return;
            }

            const maxLength = window.ChattersApp?.config?.MAX_USERNAME_LENGTH || 20;
            if (username.length > maxLength) {
                this.showNotification('Error', `Username must be less than ${maxLength} characters`, 'error');
                return;
            }

            const roomIdNum = parseInt(roomId, 10);
            if (isNaN(roomIdNum) || roomIdNum <= 0) {
                this.showNotification('Error', 'Room ID must be a positive number', 'error');
                return;
            }

            this.saveToStorage(username);

            const roomInfo = await this.validateRoom(roomIdNum);

            // Validate password if room requires it
            if (roomInfo.has_password && password) {
                await this.validatePassword(roomIdNum, password);
            } else if (roomInfo.has_password && !password) {
                this.showNotification('Error', 'This room requires a password', 'error');
                return;
            }

            if (this.widgets.chat) {
                await this.widgets.chat.joinRoom(roomIdNum, username, password);
                this.showNotification('Success', `Joined room ${roomIdNum}`, 'success');
            } else {
                console.error('ChatWidget not initialized');
                this.showNotification('Error', 'Chat system not ready', 'error');
            }

        } catch (error) {
            console.error('Error joining room:', error);
            this.showNotification('Error', error.message || 'Failed to join room', 'error');
        } finally {
            this.isJoining = false;
            if (joinBtn) joinBtn.disabled = false;
        }
    }

    getElementValue(elementId) {
        const element = document.getElementById(elementId);
        return element ? element.value.trim() : '';
    }

    async validatePassword(roomId, password) {
        try {
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${roomId}/validate-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Password validation failed');
            }

            const result = await response.json();
            if (!result.valid) {
                throw new Error('Invalid password');
            }
        } catch (error) {
            throw new Error('Invalid room password');
        }
    }

    async validateRoom(roomId) {
        try {
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${roomId}`);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Room not found');
            }

            const roomInfo = await response.json();
            this.currentRoomInfo = roomInfo;

            // Show password field if room requires password
            const passwordGroup = document.getElementById('passwordGroup');
            if (passwordGroup) {
                if (roomInfo.has_password) {
                    passwordGroup.style.display = 'block';
                } else {
                    passwordGroup.style.display = 'none';
                }
            }

            return roomInfo;
        } catch (error) {
            if (error.message.includes('Room not found')) {
                throw new Error('Room does not exist');
            }
            throw new Error('Failed to connect to server');
        }
    }

    showNotification(title, message, type = 'info') {
        try {
            if (window.notificationSystem) {
                window.notificationSystem.show(title, message, type);
            } else {
                console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
            }
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    getWidget(widgetName) {
        return this.widgets[widgetName];
    }

    isReady() {
        return this.isInitialized;
    }
}

// Utility function to debounce events
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Global error handlers
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

window.ChatApp = ChatApp;