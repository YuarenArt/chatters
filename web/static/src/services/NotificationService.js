import { EventEmitter } from '../core/utils/EventEmitter';

export class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.notifications = new Map();
    this.nextId = 1;
    this.settings = {
      defaultDuration: 5000, // 5 seconds
      maxNotifications: 5,
      position: 'top-right'
    };
  }

  /**
   * Show a notification
   * @param {string} message - The message to display
   * @param {Object} options - Notification options
   * @param {string} [options.type='info'] - Type of notification (info, success, warning, error)
   * @param {number} [options.duration] - Duration in ms (0 for persistent)
   * @param {Function} [options.onClose] - Callback when notification is closed
   * @returns {number} Notification ID
   */
  show(message, { type = 'info', duration, onClose } = {}) {
    const id = this.nextId++;
    const notification = {
      id,
      message,
      type,
      duration: duration !== undefined ? duration : this.settings.defaultDuration,
      timestamp: Date.now(),
      close: () => this.close(id)
    };

    // Add to active notifications
    this.notifications.set(id, notification);

    // Emit event
    this.emit('notification:show', notification);

    // Auto-close if duration is set
    if (notification.duration > 0) {
      notification.timeoutId = setTimeout(() => {
        this.close(id);
      }, notification.duration);
    }

    // Enforce max notifications
    this.enforceMaxNotifications();

    return id;
  }

  /**
   * Close a notification by ID
   * @param {number} id - Notification ID
   */
  close(id) {
    const notification = this.notifications.get(id);
    if (!notification) return;

    // Clear timeout if exists
    if (notification.timeoutId) {
      clearTimeout(notification.timeoutId);
    }

    // Remove from active notifications
    this.notifications.delete(id);

    // Emit event
    this.emit('notification:close', { id });
  }

  /**
   * Close all notifications
   */
  closeAll() {
    this.notifications.forEach(notification => {
      if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
      }
    });

    this.notifications.clear();
    this.emit('notification:close:all');
  }

  /**
   * Update notification settings
   * @param {Object} settings - New settings
   */
  updateSettings(settings) {
    Object.assign(this.settings, settings);
    this.emit('settings:update', this.settings);
  }

  /**
   * Enforce maximum number of notifications
   * @private
   */
  enforceMaxNotifications() {
    if (this.notifications.size <= this.settings.maxNotifications) return;

    // Get notifications sorted by timestamp (oldest first)
    const notifications = Array.from(this.notifications.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    // Close oldest notifications until we're under the limit
    while (this.notifications.size > this.settings.maxNotifications) {
      const notification = notifications.shift();
      if (notification) {
        this.close(notification.id);
      }
    }
  }

  /**
   * Show success notification
   * @param {string} message - The message to display
   * @param {Object} options - Notification options
   * @returns {number} Notification ID
   */
  success(message, options = {}) {
    return this.show(message, { ...options, type: 'success' });
  }

  /**
   * Show error notification
   * @param {string} message - The message to display
   * @param {Object} options - Notification options
   * @returns {number} Notification ID
   */
  error(message, options = {}) {
    return this.show(message, { ...options, type: 'error' });
  }

  /**
   * Show warning notification
   * @param {string} message - The message to display
   * @param {Object} options - Notification options
   * @returns {number} Notification ID
   */
  warning(message, options = {}) {
    return this.show(message, { ...options, type: 'warning' });
  }

  /**
   * Show info notification
   * @param {string} message - The message to display
   * @param {Object} options - Notification options
   * @returns {number} Notification ID
   */
  info(message, options = {}) {
    return this.show(message, { ...options, type: 'info' });
  }
}
