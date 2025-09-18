export class BaseView {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.elements = [];
  }

  /**
   * Render the view
   * Should be implemented by child classes
   */
  async render() {
    throw new Error('Render method must be implemented by child class');
  }

  /**
   * Clear the container
   */
  clearContainer() {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  /**
   * Create a DOM element with given options
   */
  createElement(tag, options = {}) {
    const element = document.createElement(tag);
    
    // Set attributes
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
    }
    
    // Set classes
    if (options.classes) {
      const classes = Array.isArray(options.classes) 
        ? options.classes 
        : options.classes.split(' ');
      
      element.classList.add(...classes);
    }
    
    // Set text content
    if (options.text) {
      element.textContent = options.text;
    }
    
    // Set HTML content
    if (options.html) {
      element.innerHTML = options.html;
    }
    
    // Set event listeners
    if (options.events) {
      Object.entries(options.events).forEach(([event, handler]) => {
        element.addEventListener(event, handler);
        // Store reference for cleanup
        this.elements.push({ element, event, handler });
      });
    }
    
    // Append to parent if specified
    if (options.parent) {
      options.parent.appendChild(element);
    }
    
    return element;
  }

  /**
   * Show a loading state
   */
  showLoading(message = 'Loading...') {
    const loadingElement = this.createElement('div', {
      classes: ['loading-overlay'],
      html: `
        <div class="spinner"></div>
        <p>${message}</p>
      `
    });
    
    this.container.appendChild(loadingElement);
    return loadingElement;
  }

  /**
   * Hide loading state
   */
  hideLoading(loadingElement) {
    if (loadingElement && loadingElement.parentNode === this.container) {
      this.container.removeChild(loadingElement);
    }
  }

  /**
   * Show a notification
   */
  showNotification(message, type = 'info', duration = 5000) {
    const notification = this.createElement('div', {
      classes: ['notification', `notification-${type}`],
      text: message
    });
    
    this.container.appendChild(notification);
    
    // Auto-remove notification
    setTimeout(() => {
      if (notification.parentNode === this.container) {
        this.container.removeChild(notification);
      }
    }, duration);
    
    return notification;
  }

  /**
   * Clean up event listeners and other resources
   */
  destroy() {
    // Remove all event listeners
    this.elements.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    
    this.elements = [];
    
    // Clear the container
    this.clearContainer();
  }
}
