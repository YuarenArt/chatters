// Notification system
class NotificationSystem {
    constructor() {
        this.container = null;
        this.notifications = [];
        this.init();
    }

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

    removeFromList(notification) {
        const index = this.notifications.indexOf(notification);
        if (index > -1) {
            this.notifications.splice(index, 1);
        }
    }

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

    success(title, message, duration) {
        this.show(title, message, 'success', duration);
    }

    error(title, message, duration) {
        this.show(title, message, 'error', duration);
    }

    warning(title, message, duration) {
        this.show(title, message, 'warning', duration);
    }

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