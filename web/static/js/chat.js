class ChatWidget {
    constructor() {
        this.ws = null;
        this.currentRoom = null;
        this.username = '';
        this.isConnected = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = window.ChattersApp?.config?.RECONNECT_ATTEMPTS || 5;
        this.reconnectDelay = window.ChattersApp?.config?.RECONNECT_DELAY || 1000;
        this.init();
    }

    init() {
        try {
            this.bindEvents();
            this.isInitialized = true;
            console.log('ChatWidget initialized');
        } catch (error) {
            console.error('ChatWidget initialization error:', error);
            this.showNotification('Error', 'Failed to initialize chat', 'error');
        }
    }

    bindEvents() {
        this.waitForElements().then(() => {
            this.attachEventListeners();
        }).catch(error => {
            console.error('Failed to bind ChatWidget events:', error);
            this.showNotification('Error', 'Failed to bind chat events', 'error');
        });
    }

    async waitForElements() {
        const requiredElements = [
            'leaveBtn',
            'sendBtn',
            'messageInput',
            'chatMessages',
            'currentRoomId',
            'onlineCount'
        ];

        for (const elementId of requiredElements) {
            await this.waitForElement(elementId);
        }
    }

    waitForElement(elementId, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const element = document.getElementById(elementId);
            if (element) {
                resolve(element);
                return;
            }

            const timeoutId = setTimeout(() => {
                reject(new Error(`Element #${elementId} not found within ${timeout}ms`));
            }, timeout);

            const observer = new MutationObserver((mutations, obs) => {
                const element = document.getElementById(elementId);
                if (element) {
                    clearTimeout(timeoutId);
                    obs.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    attachEventListeners() {
        try {
            const leaveBtn = document.getElementById('leaveBtn');
            const sendBtn = document.getElementById('sendBtn');
            const messageInput = document.getElementById('messageInput');

            if (leaveBtn) {
                leaveBtn.addEventListener('click', () => this.leaveRoom());
            }

            if (sendBtn) {
                sendBtn.addEventListener('click', () => this.sendMessage());
                sendBtn.disabled = !this.isConnected;
            }

            if (messageInput) {
                messageInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });
                messageInput.disabled = !this.isConnected;
            }

            console.log('ChatWidget events bound');
        } catch (error) {
            console.error('Error binding ChatWidget events:', error);
            this.showNotification('Error', 'Failed to bind chat events', 'error');
        }
    }

    async joinRoom(roomId, username) {
        try {
            if (!roomId || !username) {
                throw new Error('Room ID or username not specified');
            }

            if (this.isConnected && this.currentRoom === roomId && this.username === username) {
                this.showNotification('Info', 'Already connected to this room', 'info');
                return;
            }

            if (this.ws && this.isConnected) {
                this.leaveRoom();
            }

            this.currentRoom = roomId;
            this.username = username;
            await this.connectWebSocket(roomId, username);
            console.log('Joining room:', roomId, 'as', username);
        } catch (error) {
            console.error('Error joining room:', error);
            this.showNotification('Error', error.message || 'Failed to join room', 'error');
        }
    }

    async connectWebSocket(roomId, username) {
        try {
            const wsUrl = `${window.ChattersApp.config.WS_BASE_URL}/${roomId}?username=${encodeURIComponent(username)}`;
            console.log('Connecting to WebSocket:', wsUrl);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.showChatRoom();

                const roomIdElement = document.getElementById('currentRoomId');
                if (roomIdElement) {
                    roomIdElement.textContent = roomId;
                }

                this.updateUIState();

                this.showNotification('Connected!', `You joined room #${roomId}`, 'success');
                console.log('WebSocket connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                    this.showNotification('Error', 'Invalid message received', 'error');
                }
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;
                this.updateUIState();
                console.log('WebSocket closed:', event.code, event.reason);

                if (!event.wasClean) {
                    this.handleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                this.isConnected = false;
                this.updateUIState();
                console.error('WebSocket error:', error);
                this.showNotification('Error', 'Chat connection error', 'error');
            };
        } catch (error) {
            console.error('Error creating WebSocket:', error);
            this.showNotification('Error', 'Failed to create connection', 'error');
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.showNotification('Reconnecting...', `Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'info');

            setTimeout(() => {
                if (this.currentRoom && this.username) {
                    console.log('Reconnection attempt:', this.reconnectAttempts);
                    this.connectWebSocket(this.currentRoom, this.username);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.showNotification('Error', 'Failed to reconnect. Please try again.', 'error');
            this.leaveRoom();
        }
    }

    handleMessage(message) {
        try {
            console.log('WebSocket message received:', message);

            switch (message.type) {
                case 'chat':
                    console.log('Processing chat message:', message.data);
                    this.addChatMessage(message.data);
                    break;
                case 'join':
                    console.log('Processing join notification:', message.data);
                    this.addSystemMessage(`${message.data.username} joined the chat`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'leave':
                    console.log('Processing leave notification:', message.data);
                    this.addSystemMessage(`${message.data.username} left the chat`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'error':
                    console.log('Processing error message:', message.data);
                    this.showNotification('Error', message.data.message || 'Server error', 'error');
                    if (message.data.message.includes('username already taken')) {
                        this.leaveRoom();
                    }
                    break;
                default:
                    console.log('Unknown message type:', message);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.showNotification('Error', 'Failed to process message', 'error');
        }
    }

    addChatMessage(data) {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (!messagesContainer) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${data.username === this.username ? 'own' : ''}`;

            const timestamp = new Date().toLocaleTimeString('en-US', {
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
        } catch (error) {
            console.error('Error adding chat message:', error);
            this.showNotification('Error', 'Failed to display message', 'error');
        }
    }

    addSystemMessage(text) {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (!messagesContainer) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = 'system-message';
            messageDiv.textContent = text;

            messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
        } catch (error) {
            console.error('Error adding system message:', error);
            this.showNotification('Error', 'Failed to display system message', 'error');
        }
    }

    updateOnlineCount(count) {
        try {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) {
                onlineCountElement.textContent = count || 0;
            }
        } catch (error) {
            console.error('Error updating online count:', error);
        }
    }

    sendMessage() {
        try {
            const input = document.getElementById('messageInput');
            if (!input || !this.isConnected) {
                this.showNotification('Error', 'Not connected to chat', 'error');
                return;
            }

            const text = input.value.trim();
            if (!text) return;

            const maxLength = window.ChattersApp?.config?.MAX_MESSAGE_LENGTH || 1000;
            if (text.length > maxLength) {
                this.showNotification('Error', `Message must be less than ${maxLength} characters`, 'error');
                return;
            }

            const message = {
                type: 'chat',
                data: { text: text }
            };

            this.ws.send(JSON.stringify(message));
            input.value = '';
            console.log('Message sent');
        } catch (error) {
            console.error('Error sending message:', error);
            this.showNotification('Error', 'Failed to send message', 'error');
        }
    }

    leaveRoom() {
        try {
            if (this.ws) {
                this.ws.close(1000, 'User left');
                this.ws = null;
            }

            this.isConnected = false;
            this.currentRoom = null;
            this.reconnectAttempts = 0;

            const messagesContainer = document.getElementById('chatMessages');
            const messageInput = document.getElementById('messageInput');
            const sendBtn = document.getElementById('sendBtn');

            if (messagesContainer) messagesContainer.innerHTML = '';
            if (messageInput) {
                messageInput.value = '';
                messageInput.disabled = true;
            }
            if (sendBtn) sendBtn.disabled = true;

            if (window.ChattersApp?.utils) {
                window.ChattersApp.utils.showConnectionForm();
            }

            this.showNotification('Info', 'You left the chat', 'info');
            console.log('User left room');
        } catch (error) {
            console.error('Error leaving room:', error);
            this.showNotification('Error', 'Failed to leave room', 'error');
        }
    }

    disconnect() {
        try {
            if (this.ws) {
                this.ws.close(1000, 'Page unload');
                this.ws = null;
            }
            this.isConnected = false;
            console.log('WebSocket disconnected on page unload');
        } catch (error) {
            console.error('Error disconnecting WebSocket:', error);
        }
    }

    showChatRoom() {
        try {
            const connectionForm = document.getElementById('connectionForm');
            const chatRoom = document.getElementById('chatRoom');

            if (connectionForm) connectionForm.classList.add('hidden');
            if (chatRoom) chatRoom.classList.remove('hidden');

            const messageInput = document.getElementById('messageInput');
            if (messageInput) messageInput.focus();
        } catch (error) {
            console.error('Error showing chat:', error);
            this.showNotification('Error', 'Failed to show chat room', 'error');
        }
    }

    scrollToBottom() {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (error) {
            console.error('Error scrolling to bottom:', error);
        }
    }

    escapeHtml(text) {
        try {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        } catch (error) {
            console.error('Error escaping HTML:', error);
            return text;
        }
    }

    updateUIState() {
        try {
            const sendBtn = document.getElementById('sendBtn');
            const messageInput = document.getElementById('messageInput');

            if (sendBtn) sendBtn.disabled = !this.isConnected;
            if (messageInput) messageInput.disabled = !this.isConnected;
        } catch (error) {
            console.error('Error updating UI state:', error);
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
}

window.ChatWidget = ChatWidget;