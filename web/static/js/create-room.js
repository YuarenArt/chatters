// Create room widget
class CreateRoomWidget {
    constructor() {
        this.isInitialized = false;
        this.currentRoomId = null;
        this.init();
    }

    init() {
        try {
            this.bindEvents();
            this.isInitialized = true;
            console.log('CreateRoomWidget initialized');
        } catch (error) {
            console.error('CreateRoomWidget initialization error:', error);
        }
    }

    bindEvents() {
        // Bind events only after DOM is fully loaded
        this.waitForElements().then(() => {
            this.attachEventListeners();
        }).catch(error => {
            console.error('Failed to bind CreateRoomWidget events:', error);
        });
    }

    async waitForElements() {
        const requiredElements = [
            'closeModalBtn',
            'copyRoomIdBtn', 
            'joinNewRoomBtn',
            'newRoomId'
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
            const closeBtn = document.getElementById('closeModalBtn');
            const copyBtn = document.getElementById('copyRoomIdBtn');
            const joinBtn = document.getElementById('joinNewRoomBtn');

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideCreateRoomModal());
            }
            
            if (copyBtn) {
                copyBtn.addEventListener('click', () => this.copyRoomId());
            }
            
            if (joinBtn) {
                joinBtn.addEventListener('click', () => this.joinNewRoom());
            }

            console.log('CreateRoomWidget events bound');
        } catch (error) {
            console.error('Error binding CreateRoomWidget events:', error);
        }
    }

    showCreateRoomModal() {
        try {
            const modal = document.getElementById('createRoomModal');
            if (modal) {
                modal.classList.remove('hidden');
                this.createRoom();
            } else {
                console.error('Create room modal not found');
            }
        } catch (error) {
            console.error('Error showing modal:', error);
        }
    }

    hideCreateRoomModal() {
        try {
            const modal = document.getElementById('createRoomModal');
            if (modal) {
                modal.classList.add('hidden');
                this.currentRoomId = null;
            }
        } catch (error) {
            console.error('Error hiding modal:', error);
        }
    }

    async createRoom() {
        try {
            console.log('Creating new room...');
            
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                this.currentRoomId = data.room_id;
                
                const roomIdElement = document.getElementById('newRoomId');
                if (roomIdElement) {
                    roomIdElement.textContent = data.room_id;
                }
                
                this.showNotification('Room Created!', `ID: ${data.room_id}`, 'success');
                console.log('Room created:', data.room_id);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create room');
            }
        } catch (error) {
            console.error('Room creation error:', error);
            this.showNotification('Error', error.message || 'Failed to create room', 'error');
        }
    }

    copyRoomId() {
        try {
            if (!this.currentRoomId) {
                this.showNotification('Error', 'Room ID not found', 'error');
                return;
            }

            navigator.clipboard.writeText(this.currentRoomId.toString()).then(() => {
                this.showNotification('Copied!', 'Room ID copied to clipboard', 'success');
                console.log('Room ID copied:', this.currentRoomId);
            }).catch(() => {
                this.showNotification('Error', 'Failed to copy ID', 'error');
            });
        } catch (error) {
            console.error('Error copying room ID:', error);
            this.showNotification('Error', 'Failed to copy ID', 'error');
        }
    }

    joinNewRoom() {
        try {
            if (!this.currentRoomId) {
                this.showNotification('Error', 'Room ID not found', 'error');
                return;
            }

            const roomIdInput = document.getElementById('roomId');
            if (roomIdInput) {
                roomIdInput.value = this.currentRoomId;
                this.hideCreateRoomModal();
                
                // Show connection form
                if (window.ChattersApp.utils) {
                    window.ChattersApp.utils.showConnectionForm();
                }
                
                console.log('Transitioning to room connection:', this.currentRoomId);
            }
        } catch (error) {
            console.error('Error transitioning to room:', error);
            this.showNotification('Error', 'Failed to transition to room', 'error');
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
}

// Export class to global scope (no auto-initialization)
window.CreateRoomWidget = CreateRoomWidget;