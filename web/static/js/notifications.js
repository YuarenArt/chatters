/**
 * @file notifications.js
 * @brief Модуль уведомлений Chatters
 * @ingroup notifications_module
 * 
 * @details Этот модуль содержит класс NotificationSystem, который управляет
 * отображением системных уведомлений в пользовательском интерфейсе.
 * Основные возможности:
 * - Отображение информационных, предупреждающих и ошибочных уведомлений
 * - Автоматическое скрытие уведомлений по таймауту
 * - Управление очередью уведомлений
 * - Поддержка различных типов уведомлений (success, info, warning, error)
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 * 
 * @defgroup notifications_module Модуль уведомлений
 * @brief Система отображения уведомлений
 * @details Содержит классы и функции для вывода пользовательских
 * уведомлений в интерфейсе приложения.
 */

/**
 * @class NotificationSystem
 * @brief Система управления уведомлениями
 * 
 * @details Управляет отображением и скрытием уведомлений в UI.
 */
class NotificationSystem {
    /**
     * @brief Конструктор класса NotificationSystem
     * 
     * @details Инициализирует контейнер уведомлений и массив активных уведомлений.
     */
    constructor() {
        this.container = null;
        this.notifications = [];
        this.init();
    }

    /**
     * @brief Инициализация системы уведомлений
     * 
     * @details Находит контейнер для уведомлений в DOM.
     * 
     * @return {void}
     */
    init() {
        try {
            this.container = document.getElementById('notifications');
            if (!this.container) {
                console.warn('Notification container not found');
            }
            console.log('NotificationSystem initialized');
        } catch (error) {
            console.error('NotificationSystem initialization error:', error);
        }
    }

    /**
     * @brief Отображение уведомления
     * 
     * @details Создает и показывает уведомление с автоматическим скрытием.
     * 
     * @param {string} title Заголовок уведомления
     * @param {string} message Текст сообщения
     * @param {string} type Тип уведомления ('info', 'success', 'warning', 'error')
     * @param {number} duration Длительность отображения в миллисекундах
     * @return {void}
     */
    show(title, message, type = 'info', duration = 5000) {
        try {
            if (!this.container) {
                console.warn('Notification container not available');
                return;
            }

            const notification = this.createNotification(title, message, type);
            this.container.appendChild(notification);

            // Add to tracking list
            this.notifications.push(notification);

            setTimeout(() => {
                this.hide(notification);
            }, duration);

            requestAnimationFrame(() => {
                notification.style.opacity = '1';
                notification.style.transform = 'translateX(0)';
            });

            console.log(`Notification shown: [${type}] ${title}`);
            
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    /**
     * @brief Создание DOM-элемента уведомления
     * 
     * @details Создает HTML-элемент уведомления с иконкой и кнопкой закрытия.
     * 
     * @param {string} title Заголовок
     * @param {string} message Сообщение
     * @param {string} type Тип уведомления
     * @return {HTMLElement} DOM-элемент уведомления
     */
    createNotification(title, message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icon = this.getNotificationIcon(type);
        
        notification.innerHTML = `
            <div class="notification-content">
                <i class="notification-icon ${icon}"></i>
                <div class="notification-text">
                    <div class="notification-title">${this.escapeHtml(title)}</div>
                    <div class="notification-message">${this.escapeHtml(message)}</div>
                </div>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';

        return notification;
    }

    /**
     * @brief Скрытие уведомления
     * 
     * @details Скрывает уведомление с анимацией или без.
     * 
     * @param {HTMLElement} notification Элемент уведомления
     * @param {boolean} animate Использовать анимацию
     * @return {void}
     */
    hide(notification, animate = true) {
        try {
            if (!notification || !notification.parentNode) return;

            if (animate) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                        this.removeFromList(notification);
                    }
                }, 300);
            } else {
                notification.parentNode.removeChild(notification);
                this.removeFromList(notification);
            }
        } catch (error) {
            console.error('Error hiding notification:', error);
        }
    }

    /**
     * @brief Удаление уведомления из списка
     * 
     * @details Удаляет уведомление из массива отслеживания.
     * 
     * @param {HTMLElement} notification Элемент уведомления
     * @return {void}
     */
    removeFromList(notification) {
        const index = this.notifications.indexOf(notification);
        if (index > -1) {
            this.notifications.splice(index, 1);
        }
    }

    /**
     * @brief Скрытие всех уведомлений
     * 
     * @details Скрывает все активные уведомления без анимации.
     * 
     * @return {void}
     */
    hideAll() {
        try {
            this.notifications.forEach(notification => {
                this.hide(notification, false);
            });
            this.notifications = [];
        } catch (error) {
            console.error('Error hiding all notifications:', error);
        }
    }

    /**
     * @brief Получение иконки для типа уведомления
     * 
     * @details Возвращает класс FontAwesome иконки в зависимости от типа.
     * 
     * @param {string} type Тип уведомления
     * @return {string} Класс CSS иконки
     */
    getNotificationIcon(type) {
        switch (type) {
            case 'success':
                return 'fas fa-check-circle';
            case 'error':
                return 'fas fa-exclamation-circle';
            case 'warning':
                return 'fas fa-exclamation-triangle';
            case 'info':
            default:
                return 'fas fa-info-circle';
        }
    }

    /**
     * @brief Экранирование HTML
     * 
     * @details Безопасно экранирует HTML-символы в тексте.
     * 
     * @param {string} text Текст для экранирования
     * @return {string} Экранированный текст
     */
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

    /**
     * @brief Показать уведомление об успехе
     * 
     * @param {string} title Заголовок
     * @param {string} message Сообщение
     * @param {number} duration Длительность
     * @return {void}
     */
    success(title, message, duration) {
        this.show(title, message, 'success', duration);
    }

    /**
     * @brief Показать уведомление об ошибке
     * 
     * @param {string} title Заголовок
     * @param {string} message Сообщение
     * @param {number} duration Длительность
     * @return {void}
     */
    error(title, message, duration) {
        this.show(title, message, 'error', duration);
    }

    /**
     * @brief Показать предупреждение
     * 
     * @param {string} title Заголовок
     * @param {string} message Сообщение
     * @param {number} duration Длительность
     * @return {void}
     */
    warning(title, message, duration) {
        this.show(title, message, 'warning', duration);
    }

    /**
     * @brief Показать информационное уведомление
     * 
     * @param {string} title Заголовок
     * @param {string} message Сообщение
     * @param {number} duration Длительность
     * @return {void}
     */
    info(title, message, duration) {
        this.show(title, message, 'info', duration);
    }
}

if (!window.notificationSystem) {
    window.notificationSystem = new NotificationSystem();
    console.log('Global notification system created');
} else {
    console.log('Notification system already exists, using existing instance');
}

window.NotificationSystem = NotificationSystem; 