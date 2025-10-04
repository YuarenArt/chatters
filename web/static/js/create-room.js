/**
 * @file create-room.js
 * @brief Модуль создания комнат Chatters
 * @ingroup rooms_module
 * 
 * @details Этот модуль содержит класс CreateRoomWidget, который управляет
 * процессом создания новых комнат чата. Предоставляет интерфейс для:
 * - Создания комнат с опциональным паролем
 * - Получения ID комнаты и токена хоста
 * - Копирования данных в буфер обмена
 * - Перехода к подключению к созданной комнате
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 * 
 * @defgroup rooms_module Модуль комнат
 * @brief Управление комнатами чата
 * @details Содержит классы и функции для создания и управления комнатами,
 * включая защиту паролем и управление доступом.
 */

/**
 * @class CreateRoomWidget
 * @brief Виджет для создания новых комнат чата
 * 
 * @details CreateRoomWidget управляет модальным окном создания комнаты.
 * Основные функции:
 * - Отображение и скрытие модального окна
 * - Отправка запроса на создание комнаты к API
 * - Отображение ID комнаты и токена хоста
 * - Копирование данных в буфер обмена
 * - Переход к форме подключения с предзаполненным ID
 */
class CreateRoomWidget {
    /**
     * @brief Конструктор класса CreateRoomWidget
     * 
     * @details Инициализирует свойства виджета и запускает процесс инициализации.
     */
    constructor() {
        this.isInitialized = false;
        this.currentRoomId = null;
        this.init();
    }

    /**
     * @brief Инициализация виджета
     * 
     * @details Запускает привязку обработчиков событий и устанавливает флаг инициализации.
     * 
     * @return {void}
     */
    init() {
        try {
            this.bindEvents();
            this.isInitialized = true;
            console.log('CreateRoomWidget initialized');
        } catch (error) {
            console.error('CreateRoomWidget initialization error:', error);
        }
    }

    /**
     * @brief Привязка обработчиков событий
     * 
     * @details Ожидает загрузки необходимых элементов DOM, затем привязывает к ним обработчики.
     * 
     * @return {void}
     */
    bindEvents() {
        // Bind events only after DOM is fully loaded
        this.waitForElements().then(() => {
            this.attachEventListeners();
        }).catch(error => {
            console.error('Failed to bind CreateRoomWidget events:', error);
        });
    }

    /**
     * @brief Ожидание загрузки основных элементов DOM
     * 
     * @details Последовательно ожидает появления всех критически важных элементов интерфейса.
     * 
     * @return {Promise<void>} Промис, разрешающийся после загрузки всех элементов
     */
    async waitForElements() {
        const requiredElements = [
            'closeModalBtn',
            'copyRoomIdBtn', 
            'joinNewRoomBtn',
            'newRoomId',
            'createRoomSubmitBtn',
            'newRoomPassword'
        ];
        
        for (const elementId of requiredElements) {
            await this.waitForElement(elementId);
        }
    }

    /**
     * @brief Ожидание появления элемента в DOM
     * 
     * @details Использует MutationObserver для отслеживания появления элемента с заданным ID.
     * 
     * @param {string} elementId ID элемента для ожидания
     * @param {number} timeout Максимальное время ожидания в миллисекундах
     * @return {Promise<HTMLElement>} Промис с найденным элементом
     */
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

    /**
     * @brief Привязка обработчиков событий к элементам
     * 
     * @details Устанавливает обработчики для кнопок модального окна создания комнаты.
     * 
     * @return {void}
     */
    attachEventListeners() {
        try {
            const closeBtn = document.getElementById('closeModalBtn');
            const copyBtn = document.getElementById('copyRoomIdBtn');
            const joinBtn = document.getElementById('joinNewRoomBtn');
            const createBtn = document.getElementById('createRoomSubmitBtn');
            const copyHostTokenBtn = document.getElementById('copyHostTokenBtn');

            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideCreateRoomModal());
            }
            
            if (copyBtn) {
                copyBtn.addEventListener('click', () => this.copyRoomId());
            }
            
            if (joinBtn) {
                joinBtn.addEventListener('click', () => this.joinNewRoom());
            }

            if (createBtn) {
                createBtn.addEventListener('click', () => this.createRoom());
            }
            if (copyHostTokenBtn) {
                copyHostTokenBtn.addEventListener('click', () => this.copyHostToken());
            }

            console.log('CreateRoomWidget events bound');
        } catch (error) {
            console.error('Error attaching event listeners:', error);
        }
    }

    /**
     * @brief Скрытие модального окна создания комнаты
     * 
     * @details Скрывает модальное окно и сбрасывает его состояние.
     * 
     * @return {void}
     */
    hideCreateRoomModal() {
        try {
            const modal = document.getElementById('createRoomModal');
            if (modal) {
                modal.classList.add('hidden');
                this.resetModal();
            }
        } catch (error) {
            console.error('Error hiding modal:', error);
        }
    }

    /**
     * @brief Сброс состояния модального окна
     * 
     * @details Очищает поля формы и возвращает UI в исходное состояние.
     * 
     * @return {void}
     */
    resetModal() {
        try {
            this.currentRoomId = null;
            this.currentHostToken = null;
            
            // Reset form
            const passwordInput = document.getElementById('newRoomPassword');
            if (passwordInput) passwordInput.value = '';
            
            // Hide room display, show create button
            const roomDisplay = document.getElementById('roomIdDisplay');
            const createBtn = document.getElementById('createRoomSubmitBtn');
            const joinBtn = document.getElementById('joinNewRoomBtn');
            
            if (roomDisplay) roomDisplay.style.display = 'none';
            if (createBtn) createBtn.style.display = 'inline-block';
            if (joinBtn) joinBtn.style.display = 'none';
        } catch (error) {
            console.error('Error resetting modal:', error);
        }
    }

    /**
     * @brief Создание новой комнаты
     * 
     * @details Отправляет запрос к API для создания комнаты с опциональным паролем.
     * Отображает ID комнаты и токен хоста после успешного создания.
     * 
     * @return {Promise<void>} Промис, разрешающийся после создания комнаты
     */
    async createRoom() {
        try {
            console.log('Creating new room...');
            
            const createBtn = document.getElementById('createRoomSubmitBtn');
            if (createBtn) createBtn.disabled = true;
            
            const password = document.getElementById('newRoomPassword')?.value || '';
            
            const requestBody = password ? { password } : {};
            
            const response = await fetch(`${window.ChattersApp.config.API_BASE_URL}/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                const data = await response.json();
                this.currentRoomId = data.room_id;
                this.currentHostToken = data.host_token;
                
                // Update UI elements
                const roomIdElement = document.getElementById('newRoomId');
                const hostTokenElement = document.getElementById('hostToken');
                const roomDisplay = document.getElementById('roomIdDisplay');
                const createBtn = document.getElementById('createRoomSubmitBtn');
                const joinBtn = document.getElementById('joinNewRoomBtn');
                
                if (roomIdElement) roomIdElement.textContent = data.room_id;
                if (hostTokenElement) hostTokenElement.textContent = data.host_token;
                if (roomDisplay) roomDisplay.style.display = 'block';
                if (createBtn) createBtn.style.display = 'none';
                if (joinBtn) joinBtn.style.display = 'inline-block';
                
                this.showNotification('Room Created!', `ID: ${data.room_id}`, 'success');
                console.log('Room created:', data.room_id);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create room');
            }
        } catch (error) {
            console.error('Room creation error:', error);
            this.showNotification('Error', error.message || 'Failed to create room', 'error');
        } finally {
            const createBtn = document.getElementById('createRoomSubmitBtn');
            if (createBtn) createBtn.disabled = false;
        }
    }

    /**
     * @brief Копирование ID комнаты в буфер обмена
     * 
     * @details Использует Clipboard API для копирования ID комнаты.
     * 
     * @return {void}
     */
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

    /**
     * @brief Копирование токена хоста в буфер обмена
     * 
     * @details Использует Clipboard API для копирования токена хоста.
     * 
     * @return {void}
     */
    copyHostToken() {
        try {
            if (!this.currentHostToken) {
                this.showNotification('Error', 'Host token not found', 'error');
                return;
            }

            navigator.clipboard.writeText(this.currentHostToken).then(() => {
                this.showNotification('Copied!', 'Host token copied to clipboard', 'success');
                console.log('Host token copied');
            }).catch(() => {
                this.showNotification('Error', 'Failed to copy token', 'error');
            });
        } catch (error) {
            console.error('Error copying host token:', error);
            this.showNotification('Error', 'Failed to copy token', 'error');
        }
    }

    /**
     * @brief Переход к подключению к созданной комнате
     * 
     * @details Заполняет поле ID комнаты и переключает на форму подключения.
     * 
     * @return {void}
     */
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

    /**
     * @brief Отображение уведомления
     * 
     * @details Делегирует отображение уведомления глобальной системе уведомлений.
     * 
     * @param {string} title Заголовок уведомления
     * @param {string} message Текст сообщения
     * @param {string} type Тип уведомления
     * @return {void}
     */
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

// Export class to global scope (no auto-initialization)
window.CreateRoomWidget = CreateRoomWidget;