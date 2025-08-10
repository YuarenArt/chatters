// Create room widget logic
class CreateRoomWidget {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('closeModalBtn').addEventListener('click', () => this.hideCreateRoomModal());
        document.getElementById('copyRoomIdBtn').addEventListener('click', () => this.copyRoomId());
        document.getElementById('joinNewRoomBtn').addEventListener('click', () => this.joinNewRoom());
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
            const response = await fetch(`${API_BASE_URL}/rooms`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('newRoomId').textContent = data.room_id;
                window.chatApp.showNotification('Комната создана!', `ID: ${data.room_id}`, 'success');
            } else {
                const error = await response.json();
                window.chatApp.showNotification('Ошибка', error.error || 'Не удалось создать комнату', 'error');
            }
        } catch (error) {
            window.chatApp.showNotification('Ошибка', 'Не удалось подключиться к серверу', 'error');
        }
    }

    copyRoomId() {
        const roomId = document.getElementById('newRoomId').textContent;
        navigator.clipboard.writeText(roomId).then(() => {
            window.chatApp.showNotification('Скопировано!', 'ID комнаты скопирован в буфер обмена', 'success');
        }).catch(() => {
            window.chatApp.showNotification('Ошибка', 'Не удалось скопировать ID', 'error');
        });
    }

    joinNewRoom() {
        const roomId = document.getElementById('newRoomId').textContent;
        if (roomId && roomId !== '...') {
            document.getElementById('roomId').value = roomId;
            this.hideCreateRoomModal();
            window.chatApp.showConnectionForm();
        }
    }
}

// Initialize application and expose globally
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});

// Expose widget globally
window.createRoomWidget = new CreateRoomWidget();