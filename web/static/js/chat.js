/**
 * @file chat.js
 * @brief Модуль виджета чата Chatters
 * @ingroup chat_module
 * 
 * @details Этот модуль содержит класс ChatWidget, который управляет всей
 * функциональностью чата в реальном времени через WebSocket-соединение.
 * Включает обработку сообщений, управление пользователями, передачу файлов
 * через WebRTC, а также функции управления комнатой для хостов.
 * 
 * Основные возможности:
 * - Установка и поддержка WebSocket-соединения с автоматическим переподключением
 * - Отправка и получение текстовых сообщений в реальном времени
 * - P2P передача файлов через WebRTC DataChannel
 * - Управление комнатой для хостов (смена пароля, кик пользователей, удаление комнаты)
 * - Отображение онлайн-счетчика пользователей
 * - Обработка системных событий (вход/выход пользователей)
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 * 
 * @defgroup chat_module Модуль чата
 * @brief Виджет чата в реальном времени
 * @details Содержит класс ChatWidget для управления WebSocket-соединением,
 * обработки сообщений и передачи файлов через WebRTC.
 */

/**
 * @class ChatWidget
 * @brief Виджет для управления чатом в реальном времени
 * 
 * @details ChatWidget является основным компонентом для работы с чатом.
 * Он управляет:
 * - WebSocket-соединением с сервером
 * - Отправкой и получением сообщений
 * - Передачей файлов через WebRTC
 * - UI элементами чата (сообщения, кнопки, формы)
 * - Переподключением при разрыве соединения
 * - Функциями управления комнатой для хостов
 * 
 * Класс использует FileTransferManager для P2P передачи файлов и
 * Web Worker для обработки больших файлов без блокировки UI.
 */
class ChatWidget {
    /**
     * @brief Конструктор класса ChatWidget
     * 
     * @details Инициализирует все свойства виджета чата и запускает
     * процесс привязки событий к элементам DOM.
     */
    constructor() {
        /**
         * @var ws
         * @brief WebSocket-соединение с сервером
         * @details Объект WebSocket для двусторонней связи с сервером чата
         */
        this.ws = null;
        
        /**
         * @var currentRoom
         * @brief ID текущей комнаты
         * @details Числовой идентификатор комнаты, к которой подключен пользователь
         */
        this.currentRoom = null;
        
        /**
         * @var username
         * @brief Имя текущего пользователя
         * @details Имя пользователя, используемое в чате
         */
        this.username = '';
        
        /**
         * @var isConnected
         * @brief Флаг активного соединения
         * @details true, если WebSocket-соединение установлено и активно
         */
        this.isConnected = false;
        
        /**
         * @var reconnectAttempts
         * @brief Счетчик попыток переподключения
         * @details Отслеживает количество неудачных попыток переподключения
         */
        this.reconnectAttempts = 0;
        
        /**
         * @var maxReconnectAttempts
         * @brief Максимальное количество попыток переподключения
         * @details После превышения лимита переподключение прекращается
         */
        this.maxReconnectAttempts = window.ChattersApp?.config?.RECONNECT_ATTEMPTS || 5;
        
        /**
         * @var reconnectDelayBase
         * @brief Базовая задержка между попытками переподключения (мс)
         * @details Используется для экспоненциального увеличения задержки
         */
        this.reconnectDelayBase = window.ChattersApp?.config?.RECONNECT_DELAY || 1000;
        
        /**
         * @var fileManager
         * @brief Менеджер передачи файлов
         * @details Экземпляр FileTransferManager для P2P передачи файлов
         */
        this.fileManager = null;
        
        /**
         * @var transferWorker
         * @brief Web Worker для обработки файлов
         * @details Worker для сборки файлов из чанков без блокировки UI
         */
        this.transferWorker = null;
        
        this.init();
    }

    /**
     * @brief Инициализация виджета чата
     * 
     * @details Запускает процесс привязки обработчиков событий к элементам DOM.
     * Обрабатывает ошибки инициализации и отображает уведомления.
     * 
     * @return {void}
     */
    init() {
        try {
            this.bindEvents();
        } catch (error) {
            console.error('ChatWidget init error:', error);
            this.showNotification('Error', 'Failed to initialize chat', 'error');
        }
    }

    /**
     * @brief Привязка обработчиков событий
     * 
     * @details Ожидает загрузки необходимых элементов DOM, затем
     * привязывает к ним обработчики событий.
     * 
     * @return {void}
     */
    bindEvents() {
        this.waitForElements().then(() => {
            this.attachEventListeners();
        }).catch(error => {
            console.error('Bind events failed:', error);
            this.showNotification('Error', 'Failed to bind chat events', 'error');
        });
    }

    /**
     * @brief Ожидание загрузки основных элементов DOM
     * 
     * @details Последовательно ожидает появления всех критически важных
     * элементов интерфейса чата в DOM.
     * 
     * @return {Promise<void>} Промис, разрешающийся после загрузки всех элементов
     */
    async waitForElements() {
        const coreElements = ['leaveBtn', 'sendBtn', 'messageInput', 'chatMessages', 'currentRoomId', 'onlineCount', 'uploadFileBtn', 'fileInput'];
        for (const id of coreElements) {
            await this.waitForElement(id);
        }
    }

    /**
     * @brief Ожидание появления элемента в DOM
     * 
     * @details Использует MutationObserver для отслеживания появления
     * элемента с заданным ID. Отклоняет промис при превышении таймаута.
     * 
     * @param {string} id ID элемента для ожидания
     * @param {number} timeout Максимальное время ожидания в миллисекундах (по умолчанию 6000)
     * @return {Promise<HTMLElement>} Промис с найденным элементом
     * @throws {Error} Выбрасывает ошибку при превышении таймаута
     */
    waitForElement(id, timeout = 6000) {
        return new Promise((resolve, reject) => {
            const el = document.getElementById(id);
            if (el) return resolve(el);
            const tid = setTimeout(() => reject(new Error(`Element #${id} not found`)), timeout);
            const obs = new MutationObserver(() => {
                const found = document.getElementById(id);
                if (found) {
                    clearTimeout(tid);
                    obs.disconnect();
                    resolve(found);
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });
        });
    }

    /**
     * @brief Привязка обработчиков событий к элементам
     * 
     * @details Устанавливает обработчики для:
     * - Кнопки выхода из комнаты
     * - Кнопки отправки сообщения
     * - Поля ввода сообщения (Enter для отправки)
     * - Кнопки загрузки файла
     * Управляет состоянием кнопок в зависимости от статуса подключения.
     * 
     * @return {void}
     */
    attachEventListeners() {
        try {
            const leaveBtn = document.getElementById('leaveBtn');
            if (leaveBtn) leaveBtn.addEventListener('click', () => this.leaveRoom());

            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => this.sendMessage());
                sendBtn.disabled = !this.isConnected;
            }

            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });
                messageInput.disabled = !this.isConnected;
            }

            const uploadBtn = document.getElementById('uploadFileBtn');
            const fileInput = document.getElementById('fileInput');
            if (uploadBtn && fileInput) {
                uploadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', (e) => this.handleFileSelected(e.target.files));
            }
        } catch (error) {
            console.error('Bind listeners error:', error);
            this.showNotification('Error', 'Failed to bind chat events', 'error');
        }
    }

    /**
     * @brief Подключение к комнате чата
     * 
     * @details Выполняет полный цикл подключения к комнате:
     * 1. Отключается от текущей комнаты (если подключена)
     * 2. Сохраняет параметры подключения
     * 3. Устанавливает WebSocket-соединение
     * 4. Инициализирует FileTransferManager для передачи файлов
     * 
     * @param {number} roomId ID комнаты для подключения
     * @param {string} username Имя пользователя
     * @param {string} password Пароль комнаты (опционально)
     * @param {string} hostToken Токен хоста для управления комнатой (опционально)
     * @return {Promise<void>} Промис, разрешающийся после подключения
     * @throws {Error} Выбрасывает ошибку при неудачном подключении
     */
    async joinRoom(roomId, username, password = '', hostToken = '') {
        try {
            if (!roomId || !username) throw new Error('Room ID or username not specified');
            if (this.isConnected) this.leaveRoom();
            this.currentRoom = roomId;
            this.username = username;
            this.hostToken = hostToken;
            await this.connectWebSocket(roomId, username, password, hostToken);
        } catch (error) {
            console.error('Join room error:', error);
            this.showNotification('Error', error.message || 'Failed to join room', 'error');
        }
    }

    /**
     * @brief Установка WebSocket-соединения
     * 
     * @details Создает WebSocket-соединение с сервером и устанавливает
     * обработчики для всех событий соединения (open, message, close, error).
     * Инициализирует Web Worker и FileTransferManager после подключения.
     * Проверяет поддержку WebRTC перед установкой соединения.
     * 
     * @param {number} roomId ID комнаты
     * @param {string} username Имя пользователя
     * @param {string} password Пароль комнаты (опционально)
     * @param {string} hostToken Токен хоста (опционально)
     * @return {Promise<void>} Промис, разрешающийся после установки соединения
     * @throws {Error} Выбрасывает ошибку, если WebRTC не поддерживается
     */
    async connectWebSocket(roomId, username, password = '', hostToken = '') {
        if (typeof RTCPeerConnection === 'undefined') {
            throw new Error('WebRTC not supported');
        }
        try {
            let wsUrl = `${window.ChattersApp.config.WS_BASE_URL}/${roomId}?username=${encodeURIComponent(username)}`;
            if (password) {
                wsUrl += `&password=${encodeURIComponent(password)}`;
            }
            if (hostToken) {
                wsUrl += `&host_token=${encodeURIComponent(hostToken)}`;
            }
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.showChatRoom();
                const roomIdElement = document.getElementById('currentRoomId');
                if (roomIdElement) roomIdElement.textContent = roomId;
                
                // Show host controls if user has host token
                const hostControls = document.getElementById('hostControls');
                if (hostControls && hostToken) {
                    hostControls.style.display = 'block';
                    this.bindHostControls();
                }
                
                this.updateUIState();
                if (typeof Worker !== 'undefined') {
                    this.transferWorker = new Worker('/static/js/worker.js');
                    this.transferWorker.onmessage = (ev) => {
                        const m = ev.data;
                        if (m.type === 'file-complete') {
                            const blob = new Blob([m.buffer], { type: m.mime });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = m.filename;
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                            this.showNotification('Success', `Downloaded ${m.filename}`, 'success');
                        } else if (m.type === 'error') {
                            this.showNotification('Error', m.message, 'error');
                        }
                    };
                }
                this.fileManager = new FileTransferManager(this.ws, this.username, {
                    addFileMessage: (data, isOwn) => this.addFileMessage(data, isOwn),
                    onTransferProgress: (id, progress, status, peer, extra) => this.updateFileMessageProgress(id, progress, status, peer, extra),
                    showNotification: (title, msg, type) => this.showNotification(title, msg, type)
                });
                this.fileManager.transferWorker = this.transferWorker;
                this.showNotification('Connected', `Joined room #${roomId}`, 'success');
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.fileManager.handleSignaling(message);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Parse message error:', error);
                }
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;
                this.updateUIState();
                
                // Hide host controls on disconnect
                const hostControls = document.getElementById('hostControls');
                if (hostControls) hostControls.style.display = 'none';
                
                if (!event.wasClean) this.handleReconnect();
            };

            this.ws.onerror = (error) => {
                this.isConnected = false;
                this.updateUIState();
                console.error('WebSocket error:', error);
                this.showNotification('Error', 'Connection error', 'error');
            };
        } catch (error) {
            console.error('Connect WS error:', error);
            this.showNotification('Error', 'Failed to connect', 'error');
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelayBase * Math.pow(2, this.reconnectAttempts - 1);
            setTimeout(() => {
                if (this.currentRoom && this.username) {
                    this.connectWebSocket(this.currentRoom, this.username, this.roomPassword, this.hostToken);
                }
            }, delay);
        } else {
            this.showNotification('Error', 'Reconnect failed', 'error');
            this.leaveRoom();
        }
    }

    handleMessage(message) {
        try {
            switch (message.type) {
                case 'chat':
                    this.addChatMessage(message.data);
                    break;
                case 'join':
                    this.addSystemMessage(`${message.data.username} joined`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'leave':
                    this.addSystemMessage(`${message.data.username} left`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'error':
                    this.showNotification('Error', message.data.message, 'error');
                    break;
            }
        } catch (error) {
            console.error('Handle message error:', error);
        }
    }

    addChatMessage(data) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${data.username === this.username ? 'own' : ''}`;
        const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
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
        if (!messagesContainer) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = text;
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addFileMessage(data, isOwn) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = `system-file-message ${isOwn ? 'own' : ''}`; // Добавлен класс own
        messageDiv.id = `file-msg-${data.transferId}`;
        const owner = isOwn ? 'You' : data.owner;
        const size = Math.round(data.filesize / 1024);
        messageDiv.innerHTML = `
        <div class="file-content">
            <strong>${owner} shared ${this.escapeHtml(data.filename)} (${size} KB)</strong>
            <button class="download-btn" data-transfer-id="${data.transferId}" data-owner="${data.owner}">
                <i class="fas fa-download"></i> Download
            </button>
            <progress value="0" max="1" class="hidden"></progress>
            <span class="status"></span>
        </div>
    `;
        if (!isOwn) {
            const downloadBtn = messageDiv.querySelector('.download-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', (e) => {
                    const btn = e.target.closest('.download-btn'); // Учитываем клик по иконке
                    btn.disabled = true;
                    this.fileManager.requestFile(data.transferId, data.owner);
                    const progressEl = messageDiv.querySelector('progress');
                    if (progressEl) progressEl.classList.remove('hidden');
                });
            }
        } else {
            const downloadBtn = messageDiv.querySelector('.download-btn');
            if (downloadBtn) downloadBtn.remove();
        }
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    updateFileMessageProgress(transferId, progress, status, peer, extra) {
        const msgDiv = document.getElementById(`file-msg-${transferId}`);
        if (!msgDiv) return;
        const prog = msgDiv.querySelector('progress');
        const stat = msgDiv.querySelector('.status');
        if (prog && progress !== null && progress >= 0 && progress <= 1) {
            prog.value = progress;
            if (!prog.classList.contains('hidden')) {
                prog.classList.remove('hidden');
            }
        }
        if (stat) {
            stat.textContent = status;
            if (status === 'completed' && this.username !== peer) {
                stat.textContent = 'Downloaded';
                if (prog) prog.value = 1; // Ensure progress is 100% on completion
            } else if (status === 'closed') {
                stat.textContent = 'Transfer cancelled';
                if (prog) prog.classList.add('hidden');
            }
        }
    }

    handleFileSelected(fileList) {
        try {
            if (!fileList.length || !this.fileManager) return;
            const file = fileList[0];
            this.fileManager.announceFile(file);
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('File select error:', err);
            this.showNotification('Error', 'Failed to upload file', 'error');
        }
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        if (!input || !this.isConnected) return;
        const text = input.value.trim();
        if (!text) return;
        const maxLength = window.ChattersApp?.config?.MAX_MESSAGE_LENGTH || 1000;
        if (text.length > maxLength) {
            this.showNotification('Error', `Message too long`, 'error');
            return;
        }
        try {
            this.ws.send(JSON.stringify({ type: 'chat', data: { text } }));
            input.value = '';
        } catch (error) {
            console.error('Send message error:', error);
            this.showNotification('Error', 'Failed to send', 'error');
        }
    }

    leaveRoom() {
        try {
            if (this.ws) this.ws.close(1000, 'User left');
            this.ws = null;
            this.isConnected = false;
            this.currentRoom = null;
            this.hostToken = null;
            this.roomPassword = null;
            this.reconnectAttempts = 0;
            
            // Hide host controls
            const hostControls = document.getElementById('hostControls');
            if (hostControls) hostControls.style.display = 'none';
            
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) messagesContainer.innerHTML = '';
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.value = '';
                messageInput.disabled = true;
            }
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) sendBtn.disabled = true;
            window.ChattersApp.utils.showConnectionForm();
            this.showNotification('Info', 'Left the chat', 'info');
        } catch (error) {
            console.error('Leave room error:', error);
            this.showNotification('Error', 'Failed to leave', 'error');
        }
    }

    disconnect() {
        if (this.ws) this.ws.close(1000, 'Page unload');
        this.isConnected = false;
    }

    showChatRoom() {
        const connectionForm = document.getElementById('connectionForm');
        const chatRoom = document.getElementById('chatRoom');
        if (connectionForm) connectionForm.classList.add('hidden');
        if (chatRoom) chatRoom.classList.remove('hidden');
        const messageInput = document.getElementById('messageInput');
        if (messageInput) messageInput.focus();
    }

    scrollToBottom() {
        const cont = document.getElementById('chatMessages');
        if (cont) cont.scrollTop = cont.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateUIState() {
        const sendBtn = document.getElementById('sendBtn');
        const messageInput = document.getElementById('messageInput');
        if (sendBtn) sendBtn.disabled = !this.isConnected;
        if (messageInput) messageInput.disabled = !this.isConnected;
    }

    showNotification(title, message, type = 'info') {
        if (window.notificationSystem) {
            window.notificationSystem.show(title, message, type);
        } else {
            console.warn(`[${type}] ${title}: ${message}`);
        }
    }

    updateOnlineCount(count) {
        const onlineCountElement = document.getElementById('onlineCount');
        if (onlineCountElement) onlineCountElement.textContent = count || 0;
    }

    bindHostControls() {
        try {
            const manageBtn = document.getElementById('manageRoomBtn');
            if (manageBtn) {
                manageBtn.addEventListener('click', () => this.showRoomManageModal());
            }
        } catch (error) {
            console.error('Error binding host controls:', error);
        }
    }

    showRoomManageModal() {
        try {
            const modal = document.getElementById('roomManageModal');
            if (modal) {
                modal.classList.remove('hidden');
                this.bindManageModalEvents();
            }
        } catch (error) {
            console.error('Error showing manage modal:', error);
        }
    }

    bindManageModalEvents() {
        try {
            const closeBtn = document.getElementById('closeManageModalBtn');
            const changePasswordBtn = document.getElementById('changePasswordBtn');
            const kickUserBtn = document.getElementById('kickUserBtn');
            const deleteRoomBtn = document.getElementById('deleteRoomBtn');

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideRoomManageModal());
            }

            if (changePasswordBtn) {
                changePasswordBtn.addEventListener('click', () => this.changeRoomPassword());
            }

            if (kickUserBtn) {
                kickUserBtn.addEventListener('click', () => this.kickUser());
            }

            if (deleteRoomBtn) {
                deleteRoomBtn.addEventListener('click', () => this.deleteRoom());
            }
        } catch (error) {
            console.error('Error binding manage modal events:', error);
        }
    }

    hideRoomManageModal() {
        try {
            const modal = document.getElementById('roomManageModal');
            if (modal) {
                modal.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error hiding manage modal:', error);
        }
    }

    async changeRoomPassword() {
        try {
            const newPassword = document.getElementById('newPassword')?.value || '';
            
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${this.currentRoom}/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.hostToken
                },
                body: JSON.stringify({ new_password: newPassword })
            });

            if (response.ok) {
                this.showNotification('Success', 'Room password changed', 'success');
                document.getElementById('newPassword').value = '';
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to change password');
            }
        } catch (error) {
            console.error('Change password error:', error);
            this.showNotification('Error', error.message || 'Failed to change password', 'error');
        }
    }

    async kickUser() {
        try {
            const username = document.getElementById('kickUsername')?.value?.trim();
            if (!username) {
                this.showNotification('Error', 'Please enter username to kick', 'error');
                return;
            }

            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${this.currentRoom}/kick`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.hostToken
                },
                body: JSON.stringify({ username })
            });

            if (response.ok) {
                this.showNotification('Success', `User ${username} kicked`, 'success');
                document.getElementById('kickUsername').value = '';
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to kick user');
            }
        } catch (error) {
            console.error('Kick user error:', error);
            this.showNotification('Error', error.message || 'Failed to kick user', 'error');
        }
    }

    async deleteRoom() {
        try {
            if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
                return;
            }

            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms/${this.currentRoom}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.hostToken
                }
            });

            if (response.ok) {
                this.showNotification('Success', 'Room deleted', 'success');
                this.hideRoomManageModal();
                this.leaveRoom();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete room');
            }
        } catch (error) {
            console.error('Delete room error:', error);
            this.showNotification('Error', error.message || 'Failed to delete room', 'error');
        }
    }
}

/**
 * @brief Экспорт класса ChatWidget в глобальную область видимости
 * 
 * @details Делает класс доступным для других модулей приложения.
 */
window.ChatWidget = ChatWidget;
