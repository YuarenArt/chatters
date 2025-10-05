/**
 * @mainpage Chatters - Real-time Chat Application
 * 
 * @section intro_sec Введение
 * 
 * **Chatters** - это современное веб-приложение для обмена сообщениями в реальном времени,
 * построенное на WebSocket технологии. Приложение поддерживает создание комнат,
 * P2P передачу файлов через WebRTC и управление доступом с помощью паролей.
 * 
 * @section features_sec Основные возможности
 * 
 * - **Real-time чат**: Мгновенный обмен сообщениями через WebSocket
 * - **Комнаты с паролями**: Защищенные комнаты с bcrypt хешированием
 * - **P2P передача файлов**: Прямая передача файлов между пользователями через WebRTC
 * - **Управление комнатами**: Функции хоста (кик пользователей, смена пароля, удаление комнаты)
 * - **Автоматическое переподключение**: Устойчивость к разрывам соединения
 * - **Система уведомлений**: Красивые toast-уведомления для пользователей
 * 
 * @section arch_sec Архитектура
 * 
 * ### Frontend (JavaScript)
 * 
 * Приложение состоит из следующих модулей:
 * 
 * - @ref app_module "Модуль приложения" - Главный контроллер и инициализация
 * - @ref chat_module "Модуль чата" - WebSocket соединение и обмен сообщениями
 * - @ref rooms_module "Модуль комнат" - Создание и управление комнатами
 * - @ref filetransfer_module "Модуль передачи файлов" - P2P передача через WebRTC
 * - @ref notifications_module "Модуль уведомлений" - Система toast-уведомлений
 * - @ref main_module "Главный модуль" - Конфигурация и точка входа
 * 
 * ### Backend (Go)
 * 
 * - **WebSocket сервер**: Обработка подключений и маршрутизация сообщений
 * - **REST API**: Создание комнат, валидация паролей, управление
 * - **TaskPool**: Оптимизированная обработка криптографических операций
 * - **Buffer Pooling**: Эффективное управление памятью
 * 
 * @section perf_sec Оптимизации производительности
 * 
 * Приложение включает множество оптимизаций:
 * 
 * 1. **WebSocket оптимизации**:
 *    - Увеличенные буферы (8KB)
 *    - Прямые goroutines вместо worker pool для I/O
 *    - Удаление middleware с WebSocket маршрутов
 * 
 * 2. **Управление памятью**:
 *    - sync.Pool для буферов сообщений
 *    - O(1) поиск клиентов через map индексы
 *    - Эффективная передача ArrayBuffer в Web Workers
 * 
 * 3. **Безопасность**:
 *    - bcrypt хеширование паролей
 *    - JWT токены для хостов
 *    - XSS защита через экранирование HTML
 * 
 * @section usage_sec Использование
 * 
 * ### Создание комнаты
 * 
 * ```javascript
 * // Через CreateRoomWidget
 * const widget = new CreateRoomWidget();
 * widget.showCreateRoomModal();
 * ```
 * 
 * ### Подключение к комнате
 * 
 * ```javascript
 * // Через ChatWidget
 * const chat = new ChatWidget();
 * await chat.joinRoom(roomId, username, password);
 * ```
 * 
 * ### Передача файла
 * 
 * ```javascript
 * // Через FileTransferManager
 * const transferId = fileManager.announceFile(file);
 * ```
 * 
 * @section config_sec Конфигурация
 * 
 * Основные настройки находятся в `main.js`:
 * 
 * - `API_BASE_URL`: URL REST API сервера
 * - `WS_BASE_URL`: URL WebSocket сервера
 * - `RECONNECT_ATTEMPTS`: Количество попыток переподключения (5)
 * - `RECONNECT_DELAY`: Задержка между попытками (1000ms)
 * - `MAX_MESSAGE_LENGTH`: Максимальная длина сообщения (1000 символов)
 * - `MAX_USERNAME_LENGTH`: Максимальная длина имени (25 символов)
 * 
 * @section tech_sec Технологии
 * 
 * **Frontend:**
 * - Vanilla JavaScript (ES6+)
 * - WebSocket API
 * - WebRTC (RTCPeerConnection, DataChannel)
 * - Web Workers
 * - FontAwesome иконки
 * 
 * **Backend:**
 * - Go 1.24
 * - Gorilla WebSocket
 * - Gin Web Framework
 * - bcrypt для хеширования
 * - JWT для токенов
 * 
 * 
 * @section author_sec Авторы
 * 
 * Chatters Development Team
 * 
 * @section version_sec Версия
 * 
 * 1.0 (2025)
 * 
 * @section license_sec Лицензия
 * 
 * [Укажите вашу лицензию здесь]
 */
