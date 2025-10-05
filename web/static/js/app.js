/**
 * @file app.js
 * @brief Модуль главного приложения Chatters
 * @ingroup app_module
 * 
 * @details Этот модуль содержит основной класс ChatApp, который управляет
 * инициализацией приложения, координацией виджетов, обработкой подключения
 * к комнатам и валидацией пользовательского ввода. Класс является центральным
 * компонентом фронтенд-архитектуры приложения.
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 * 
 * @defgroup app_module Модуль приложения
 * @brief Основной модуль приложения Chatters
 * @details Содержит точку входа и основные настройки приложения,
 * а также управление жизненным циклом и виджетами.
 */

/**
 * @class ChatApp
 * @brief Главный класс приложения для управления чат-системой
 * 
 * @details ChatApp является центральным контроллером приложения, который:
 * - Инициализирует все виджеты (ChatWidget, CreateRoomWidget)
 * - Управляет жизненним циклом приложения
 * - Обрабатывает подключение пользователей к комнатам
 * - Валидирует пользовательский ввод
 * - Координирует взаимодействие между компонентами
 * - Управляет состоянием приложения и локальным хранилищем
 * 
 * Класс следует паттерну Singleton через глобальный объект window.ChatApp
 * и обеспечивает единую точку входа для всех операций приложения.
 */
class ChatApp {
    /**
     * @brief Конструктор класса ChatApp
     * 
     * @details Инициализирует основные свойства приложения и запускает
     * процесс инициализации. Конструктор создает пустой объект виджетов
     * и устанавливает флаги состояния.
     * 
     * @note Конструктор автоматически вызывает метод init() для запуска инициализации
     */
    constructor() {
        /**
         * @property {boolean} isInitialized
         * @brief Флаг успешной инициализации приложения
         * @details Устанавливается в true после завершения всех этапов инициализации
         */
        this.isInitialized = false;
        
        /**
         * @property {Object} widgets
         * @brief Объект, содержащий все виджеты приложения
         * @details Хранит экземпляры ChatWidget и CreateRoomWidget для доступа из других модулей
         */
        this.widgets = {};
        
        /**
         * @property {boolean} isJoining
         * @brief Флаг процесса подключения к комнате
         * @details Предотвращает множественные одновременные попытки подключения
         */
        this.isJoining = false;
        
        this.init();
    }

    /**
     * @brief Асинхронная инициализация приложения
     * 
     * @details Выполняет следующие этапы инициализации:
     * 1. Ожидает загрузки DOM
     * 2. Инициализирует виджеты (ChatWidget, CreateRoomWidget)
     * 3. Привязывает обработчики событий
     * 4. Загружает данные из localStorage
     * 5. Отображает форму подключения
     * 
     * @return {Promise<void>} Промис, разрешающийся после завершения инициализации
     * @throws {Error} Выбрасывает ошибку при сбое инициализации
     */
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

    /**
     * @brief Инициализация виджетов приложения
     * 
     * @details Создает экземпляры ChatWidget и CreateRoomWidget после
     * проверки их доступности. Предотвращает дублирование виджетов.
     * Регистрирует виджеты в глобальном объекте ChattersApp.
     * 
     * @return {Promise<void>} Промис, разрешающийся после создания виджетов
     * @throws {Error} Выбрасывает ошибку, если виджеты не загружены
     */
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

    /**
     * @brief Ожидание загрузки классов виджетов
     * 
     * @details Периодически проверяет доступность конструкторов
     * CreateRoomWidget и ChatWidget в глобальной области видимости.
     * Использует polling с интервалом 100мс.
     * 
     * @param {number} [timeout=10000] - Максимальное время ожидания в миллисекундах
     * @returns {Promise<void>} Промис, разрешающийся при загрузке виджетов
     * @throws {Error} Выбрасывает ошибку при превышении таймаута
     * 
     * @see CreateRoomWidget
     * @see ChatWidget
     */
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

    /**
     * @brief Привязка основных обработчиков событий
     * 
     * @details Устанавливает обработчики для:
     * - Кнопок подключения к комнате и создания комнаты
     * - Нажатия Enter в полях ввода
     * Использует debounce для предотвращения множественных вызовов.
     * 
     * @return {void}
     */
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

    /**
     * @brief Привязка обработчика события к элементу DOM
     * 
     * @details Безопасно привязывает обработчик события к элементу.
     * Выводит предупреждение, если элемент не найден.
     * 
     * @param {string} elementId - ID элемента DOM
     * @param {string} eventType - Тип события (например, 'click', 'keypress')
     * @param {Function} handler - Функция-обработчик события
     * @returns {void}
     * 
     * @example
     * this.bindElementEvent('joinBtn', 'click', () => this.joinRoom());
     */
    bindElementEvent(elementId, eventType, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener(eventType, handler);
        } else {
            console.warn(`Element #${elementId} not found for event ${eventType}`);
        }
    }

    /**
     * @brief Загрузка данных из localStorage
     * 
     * @details Восстанавливает сохраненное имя пользователя из localStorage
     * и заполняет соответствующее поле ввода.
     * 
     * @return {void}
     */
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

    /**
     * @brief Сохранение имени пользователя в localStorage
     * 
     * @details Сохраняет имя пользователя для автозаполнения при следующем посещении.
     * 
     * @param {string} username Имя пользователя для сохранения
     * @return {void}
     */
    saveToStorage(username) {
        try {
            if (username) {
                localStorage.setItem('chatters_username', username);
            }
        } catch (error) {
            console.warn('Failed to save storage data:', error);
        }
    }

    /**
     * @brief Отображение формы подключения к комнате
     * 
     * @details Скрывает интерфейс чата и показывает форму ввода
     * данных для подключения к комнате.
     * 
     * @return {void}
     */
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

    /**
     * @brief Отображение модального окна создания комнаты
     * 
     * @details Делегирует отображение модального окна виджету CreateRoomWidget.
     * 
     * @return {void}
     */
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

    /**
     * @brief Подключение к комнате чата
     * 
     * @details Выполняет полный цикл подключения к комнате:
     * 1. Проверяет, не выполняется ли уже подключение
     * 2. Валидирует введенные данные (ID комнаты, имя пользователя)
     * 3. Проверяет существование комнаты через API
     * 4. Валидирует пароль, если комната защищена
     * 5. Инициирует WebSocket-подключение через ChatWidget
     * 
     * @return {Promise<void>} Промис, разрешающийся после подключения
     * @throws {Error} Выбрасывает ошибку при неудачной валидации или подключении
     */
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

    /**
     * @brief Получение значения элемента формы
     * 
     * @details Безопасно извлекает и обрезает значение из элемента ввода.
     * 
     * @param {string} elementId ID элемента формы
     * @return {string} Обрезанное значение элемента или пустая строка
     */
    getElementValue(elementId) {
        const element = document.getElementById(elementId);
        return element ? element.value.trim() : '';
    }

    /**
     * @brief Валидация пароля комнаты
     * 
     * @details Отправляет POST-запрос к API для проверки правильности
     * пароля комнаты перед подключением.
     * 
     * @param {number} roomId ID комнаты
     * @param {string} password Пароль для проверки
     * @return {Promise<void>} Промис, разрешающийся при успешной валидации
     * @throws {Error} Выбрасывает ошибку при неверном пароле
     */
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
        } catch (error) {
            throw new Error('Invalid room password');
        }
    }

    /**
     * @brief Валидация существования комнаты
     * 
     * @details Проверяет существование комнаты через API и получает
     * информацию о ней (наличие пароля). Управляет видимостью поля
     * ввода пароля в зависимости от настроек комнаты.
     * 
     * @param {number} roomId ID комнаты для проверки
     * @return {Promise<Object>} Промис с информацией о комнате
     * @throws {Error} Выбрасывает ошибку, если комната не существует
     */
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

    /**
     * @brief Отображение уведомления пользователю
     * 
     * @details Делегирует отображение уведомления глобальной системе
     * уведомлений. Fallback на console.log при отсутствии системы.
     * 
     * @param {string} title Заголовок уведомления
     * @param {string} message Текст уведомления
     * @param {string} type Тип уведомления ('info', 'success', 'error', 'warning')
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

    /**
     * @brief Получение виджета по имени
     * 
     * @details Предоставляет доступ к зарегистрированным виджетам.
     * 
     * @param {string} widgetName Имя виджета ('chat', 'createRoom')
     * @return {Object|undefined} Экземпляр виджета или undefined
     */
    getWidget(widgetName) {
        return this.widgets[widgetName];
    }

    /**
     * @brief Проверка готовности приложения
     * 
     * @details Возвращает статус инициализации приложения.
     * 
     * @return {boolean} true, если приложение полностью инициализировано
     */
    isReady() {
        return this.isInitialized;
    }
}

/**
 * @brief Утилита для debounce функций
 * 
 * @details Ограничивает частоту вызова функции, откладывая её выполнение
 * до момента, когда прекратятся повторные вызовы в течение указанного времени.
 * Используется для предотвращения множественных подключений к комнате.
 * 
 * @param {Function} func Функция для debounce
 * @param {number} wait Время задержки в миллисекундах
 * @return {Function} Обернутая функция с debounce
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * @brief Глобальный обработчик ошибок
 * 
 * @details Перехватывает необработанные ошибки JavaScript и логирует их.
 */
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

/**
 * @brief Глобальный обработчик отклоненных промисов
 * 
 * @details Перехватывает необработанные отклонения промисов и логирует их.
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

/**
 * @brief Экспорт класса ChatApp в глобальную область видимости
 * 
 * @details Делает класс доступным для других модулей приложения.
 */
window.ChatApp = ChatApp;