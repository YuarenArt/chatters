/**
 * @file main.js
 * @brief Главный модуль инициализации приложения Chatters
 * @ingroup main_module
 * 
 * @details Этот модуль содержит конфигурацию приложения, глобальный объект состояния
 * и функции инициализации. Отвечает за:
 * - Загрузку конфигурации приложения
 * - Инициализацию глобального состояния
 * - Привязку глобальных обработчиков событий
 * - Управление жизненным циклом приложения
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 * 
 * @defgroup main_module Главный модуль
 * @brief Модуль инициализации и конфигурации приложения
 * @details Содержит точку входа и основные настройки приложения.
 */

/**
 * @brief Конфигурация приложения
 * 
 * @details Содержит все основные настройки приложения, включая URL API,
 * параметры переподключения и ограничения на длину сообщений.
 * 
 * @property {string} API_BASE_URL - Базовый URL для REST API
 * @property {string} WS_BASE_URL - Базовый URL для WebSocket соединений
 * @property {number} RECONNECT_ATTEMPTS - Максимальное количество попыток переподключения
 * @property {number} RECONNECT_DELAY - Задержка между попытками переподключения (мс)
 * @property {number} MAX_MESSAGE_LENGTH - Максимальная длина сообщения в символах
 * @property {number} MAX_USERNAME_LENGTH - Максимальная длина имени пользователя
 */
const CONFIG = {
    API_BASE_URL: 'http://localhost:8080/api',
    WS_BASE_URL: 'ws://localhost:8080/ws',
    RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 1000,
    MAX_MESSAGE_LENGTH: 1000,
    MAX_USERNAME_LENGTH: 25
};

/**
 * @brief Глобальный объект приложения Chatters
 * 
 * @details Содержит конфигурацию, виджеты и состояние приложения.
 * Доступен глобально через window.ChattersApp.
 * 
 * @property {Object} config - Конфигурация приложения
 * @property {Object} widgets - Контейнер для виджетов приложения
 * @property {Object} state - Состояние приложения
 * @property {boolean} state.isInitialized - Флаг инициализации
 * @property {number|null} state.currentRoom - ID текущей комнаты
 * @property {string|null} state.username - Имя пользователя
 */
window.ChattersApp = {
    config: CONFIG,
    widgets: {},
    state: {
        isInitialized: false,
        currentRoom: null,
        username: null
    }
};

/**
 * @brief Асинхронная инициализация приложения
 * 
 * @details Выполняет следующие этапы:
 * 1. Ожидает загрузки DOM
 * 2. Ожидает загрузки необходимых элементов
 * 3. Привязывает глобальные обработчики событий
 * 4. Загружает сохраненные данные из localStorage
 * 5. Отображает форму подключения
 * 
 * @return {Promise<void>} Промис, разрешающийся после инициализации
 */
async function initializeApp() {
    try {
        console.log('Initializing Chatters application...');

        // Wait for DOM to load
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }

        await waitForElements();

        bindGlobalEvents();
        loadStoredData();
        showConnectionForm();

        window.ChattersApp.state.isInitialized = true;

        console.log('Application successfully initialized');

    } catch (error) {
        console.error('Application initialization error:', error);
        showGlobalError('Initialization Error', 'Failed to start application');
    }
}

/**
 * @brief Ожидание загрузки необходимых элементов DOM
 * 
 * @details Последовательно ожидает появления всех критически важных элементов.
 * 
 * @return {Promise<void>} Промис, разрешающийся после загрузки всех элементов
 */
async function waitForElements() {
    const requiredElements = [
        'connectionForm',
        'chatRoom',
        'createRoomModal',
        'notifications'
    ];

    for (const elementId of requiredElements) {
        await waitForElement(elementId);
    }
}

/**
 * @brief Ожидание появления элемента в DOM
 * 
 * @details Использует MutationObserver для отслеживания появления элемента.
 * 
 * @param {string} elementId - ID элемента для ожидания
 * @param {number} [timeout=5000] - Максимальное время ожидания в миллисекундах
 * @returns {Promise<HTMLElement>} Промис с найденным элементом
 * @throws {Error} Выбрасывает ошибку при превышении таймаута
 */
function waitForElement(elementId, timeout = 5000) {
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
 * @brief Привязка глобальных обработчиков событий
 * 
 * @details Устанавливает обработчики для глобальных событий:
 * - Ошибки JavaScript
 * - Необработанные отклонения промисов
 * - Закрытие страницы
 * - Изменение видимости страницы
 * 
 * @return {void}
 */
function bindGlobalEvents() {

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('Global events bound');
}

/**
 * @brief Обработчик глобальных ошибок JavaScript
 * 
 * @details Логирует ошибки и отображает уведомление пользователю.
 * 
 * @param {ErrorEvent} event Событие ошибки
 * @return {void}
 */
function handleGlobalError(event) {
    console.error('Global error:', event.error);
    showGlobalError('System Error', 'An unexpected error occurred');
}

/**
 * @brief Обработчик необработанных отклонений промисов
 * 
 * @details Логирует отклонения промисов и отображает уведомление.
 * 
 * @param {PromiseRejectionEvent} event Событие отклонения промиса
 * @return {void}
 */
function handleUnhandledRejection(event) {
    console.error('Unhandled promise rejection:', event.reason);
    showGlobalError('Operation Error', 'Operation failed with error');
}

/**
 * @brief Обработчик закрытия страницы
 * 
 * @details Корректно закрывает WebSocket-соединение при закрытии страницы.
 * 
 * @param {BeforeUnloadEvent} event Событие закрытия страницы
 * @return {void}
 */
function handleBeforeUnload(event) {
    if (window.ChattersApp.widgets.chat?.isConnected) {
        window.ChattersApp.widgets.chat.disconnect();
    }
}

/**
 * @brief Обработчик изменения видимости страницы
 * 
 * @details Реагирует на переключение вкладок браузера.
 * 
 * @return {void}
 */
function handleVisibilityChange() {
    if (document.hidden) {
        //console.log('Page hidden');
    } else {
        //console.log('Page visible');
    }
}

/**
 * @brief Загрузка данных из localStorage
 * 
 * @details Восстанавливает сохраненное имя пользователя из localStorage.
 * 
 * @return {void}
 */
function loadStoredData() {
    try {
        const username = localStorage.getItem('chatters_username');
        if (username) {
            const usernameInput = document.getElementById('username');
            if (usernameInput) {
                usernameInput.value = username;
                window.ChattersApp.state.username = username;
            }
        }
        console.log('Storage data loaded');
    } catch (error) {
        console.warn('Failed to load storage data:', error);
    }
}

/**
 * @brief Отображение формы подключения к комнате
 * 
 * @details Скрывает интерфейс чата и показывает форму подключения.
 * 
 * @return {void}
 */
function showConnectionForm() {
    const connectionForm = document.getElementById('connectionForm');
    const chatRoom = document.getElementById('chatRoom');

    if (connectionForm) connectionForm.classList.remove('hidden');
    if (chatRoom) chatRoom.classList.add('hidden');
}

/**
 * @brief Отображение глобальной ошибки
 * 
 * @details Использует систему уведомлений для отображения ошибки.
 * 
 * @param {string} title Заголовок ошибки
 * @param {string} message Текст ошибки
 * @return {void}
 */
function showGlobalError(title, message) {
    if (window.notificationSystem) {
        window.notificationSystem.error(title, message);
    } else {
        console.error(`[ERROR] ${title}: ${message}`);
    }
}

/**
 * @brief Проверка готовности приложения
 * 
 * @details Возвращает статус инициализации приложения.
 * 
 * @return {boolean} true, если приложение инициализировано
 */
function isAppReady() {
    return window.ChattersApp.state.isInitialized;
}

/**
 * @brief Экспорт утилит в глобальную область видимости
 * 
 * @details Делает утилиты доступными для других модулей через window.ChattersApp.utils.
 */
window.ChattersApp.utils = {
    isAppReady,
    showConnectionForm,
    showGlobalError
};

/**
 * @brief Запуск инициализации приложения
 * 
 * @details Инициализирует приложение после загрузки DOM или немедленно, если DOM уже загружен.
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
