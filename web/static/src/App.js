import { Router } from './core/Router';
import { AuthService } from './services/AuthService';
import { ChatService } from './services/ChatService';
import { NotificationService } from './services/NotificationService';
import { formatDate } from './core/utils/helpers';

export class App {
  constructor() {
    // Initialize services
    this.services = {
      auth: new AuthService(),
      chat: new ChatService(),
      notifications: new NotificationService()
    };
    
    // Initialize router with services
    this.router = new Router({
      auth: this.services.auth,
      onRouteChange: this.handleRouteChange.bind(this)
    });
    
    // Bind methods
    this.handleAuthStateChange = this.handleAuthStateChange.bind(this);
    this.handleNetworkStatusChange = this.handleNetworkStatusChange.bind(this);
    this.setupGlobalErrorHandling();
  }

  async init() {
    try {
      // Initialize services
      await Promise.all([
        this.services.auth.init(),
        this.services.chat.init()
      ]);
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize router (will handle initial route)
      this.router.init();
      
      // Check network status
      this.handleNetworkStatusChange();
      
      // Log app initialization
      console.log(`%cChatters App initialized at ${formatDate(new Date())}`, 
        'color: #4a6bff; font-weight: bold');
      
    } catch (error) {
      console.error('Failed to initialize application:', error);
      this.services.notifications.error(
        'Failed to initialize application. Please refresh the page or try again later.'
      );
    }
  }
  
  setupEventListeners() {
    // Auth state changes
    this.services.auth.on('login', this.handleAuthStateChange);
    this.services.auth.on('logout', this.handleAuthStateChange);
    
    // Network status
    window.addEventListener('online', this.handleNetworkStatusChange);
    window.addEventListener('offline', this.handleNetworkStatusChange);
    
    // Service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }
  
  handleAuthStateChange(user) {
    const isAuthenticated = !!user;
    const currentPath = window.location.pathname;
    
    // Redirect based on auth state
    if (isAuthenticated) {
      // If on auth page, redirect to home or intended URL
      if (currentPath.startsWith('/auth')) {
        const redirectTo = this.router.getQueryParam('redirect');
        this.router.navigate(redirectTo || '/');
      }
    } else {
      // If not on auth page, redirect to login
      if (!currentPath.startsWith('/auth')) {
        this.router.navigate(`/auth/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    }
    
    // Update UI based on auth state
    this.updateAuthUI(isAuthenticated);
  }
  
  handleNetworkStatusChange() {
    const isOnline = navigator.onLine;
    document.documentElement.classList.toggle('offline', !isOnline);
    
    if (!isOnline) {
      this.services.notifications.warning('You are currently offline. Some features may not be available.');
    } else {
      // If we just came back online, refresh data
      this.services.chat.init();
    }
  }
  
  updateAuthUI(isAuthenticated) {
    // Update UI elements based on auth state
    const authElements = document.querySelectorAll('[data-auth]');
    authElements.forEach(el => {
      const showWhen = el.getAttribute('data-auth');
      el.style.display = (showWhen === 'authenticated' && isAuthenticated) || 
                         (showWhen === 'unauthenticated' && !isAuthenticated) ? '' : 'none';
    });
    
    // Update user info in UI if authenticated
    if (isAuthenticated && this.services.auth.currentUser) {
      const user = this.services.auth.currentUser;
      const userElements = document.querySelectorAll('[data-user]');
      
      userElements.forEach(el => {
        const prop = el.getAttribute('data-user');
        if (prop in user) {
          el.textContent = user[prop];
        }
      });
    }
  }
  
  setupGlobalErrorHandling() {
    // Global error handler
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error || event.message);
      this.services.notifications.error(
        'An unexpected error occurred. Please try again.'
      );
    });
    
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled rejection:', event.reason);
      this.services.notifications.error(
        event.reason?.message || 'An unexpected error occurred.'
      );
    });
  }
  
  destroy() {
    // Clean up event listeners
    this.services.auth.off('login', this.handleAuthStateChange);
    this.services.auth.off('logout', this.handleAuthStateChange);
    
    window.removeEventListener('online', this.handleNetworkStatusChange);
    window.removeEventListener('offline', this.handleNetworkStatusChange);
    
    // Clean up router
    this.router.destroy();
    
    // Clean up services
    this.services.chat.leaveRoom();
  }
}
