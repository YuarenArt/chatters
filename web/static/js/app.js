
class ChatApp {
    constructor() {
        this.isInitialized = false;
        this.widgets = {};
        this.init();
    }

    async init() {
        try {
            console.log('Initializing ChatApp...');
            
            // Wait for DOM to load
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                });
            }
            
            // Initialize widgets
            await this.initializeWidgets();
            
            // Bind main events
            this.bindMainEvents();
            
            // Load data from storage
            this.loadFromStorage();
            
            // Show connection form
            this.showConnectionForm();
            
            // Mark successful initialization
            this.isInitialized = true;
            
            console.log('ChatApp successfully initialized');
            
        } catch (error) {
            console.error('ChatApp initialization error:', error);
            this.showNotification('Error', 'Failed to start application', 'error');
        }
    }

    async initializeWidgets() {
        try {
            // Wait for widget classes to load
            await this.waitForWidgets();
            
            // Create widget instances only if they don't exist
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
            
            // Register widgets in global scope
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
            // Main buttons
            this.bindElementEvent('joinBtn', 'click', () => this.joinRoom());
            this.bindElementEvent('createRoomBtn', 'click', () => this.showCreateRoomModal());
            this.bindElementEvent('newRoomBtn', 'click', () => this.showCreateRoomModal());

            // Handle Enter key in input fields
            this.bindElementEvent('roomId', 'keypress', (e) => {
                if (e.key === 'Enter') this.joinRoom();
            });

            this.bindElementEvent('username', 'keypress', (e) => {
                if (e.key === 'Enter') this.joinRoom();
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
        try {
            const roomId = this.getElementValue('roomId');
            const username = this.getElementValue('username');

            if (!roomId || !username) {
                this.showNotification('Error', 'Please fill in all fields', 'error');
                return;
            }

            const maxLength = window.ChattersApp?.config?.MAX_USERNAME_LENGTH || 20;
            if (username.length > maxLength) {
                this.showNotification('Error', 'Username too long', 'error');
                return;
            }

            this.saveToStorage(username);

            // Check room existence
            await this.validateRoom(roomId);

            // Connect to chat
            if (this.widgets.chat) {
                this.widgets.chat.joinRoom(roomId, username);
            } else {
                console.error('ChatWidget not initialized');
                this.showNotification('Error', 'Chat not ready', 'error');
            }
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.showNotification('Error', error.message || 'Failed to join room', 'error');
        }
    }

    getElementValue(elementId) {
        const element = document.getElementById(elementId);
        return element ? element.value.trim() : '';
    }

    async validateRoom(roomId) {
        try {
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${roomId}`);
            if (!response.ok) {
                throw new Error('Room not found');
            }
        } catch (error) {
            if (error.message === 'Room not found') {
                throw error;
            }
            throw new Error('Failed to connect to server');
        }
    }

    showNotification(title, message, type = 'info') {
        try {
            if (window.notificationSystem) {
                window.notificationSystem.show(title, message, type);
            } else {
                // Fallback notification
                console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
            }
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    // Methods for external access
    getWidget(widgetName) {
        return this.widgets[widgetName];
    }

    isReady() {
        return this.isInitialized;
    }
}

// Global error handlers
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// Export class to global scope
window.ChatApp = ChatApp; 