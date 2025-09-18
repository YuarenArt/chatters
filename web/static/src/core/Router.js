import { AuthView } from '../features/auth/AuthView';
import { ChatView } from '../features/chat/ChatView';
import { NotFoundView } from '../features/error/NotFoundView';

export class Router {
  constructor({ auth, onRouteChange }) {
    this.routes = [];
    this.auth = auth;
    this.onRouteChange = onRouteChange;
    this.currentView = null;
    this.params = {};
    this.query = {};
    
    // Bind methods
    this.navigate = this.navigate.bind(this);
    this.handlePopState = this.handlePopState.bind(this);
    this.handleLinkClick = this.handleLinkClick.bind(this);
    
    // Initialize default routes
    this.initializeRoutes();
  }
  
  initializeRoutes() {
    // Auth routes
    this.addRoute('/auth/:action(login|register|forgot-password|reset-password)', AuthView, { 
      requiresAuth: false,
      layout: 'auth'
    });
    
    // Chat routes
    this.addRoute('/', ChatView, { 
      requiresAuth: true,
      layout: 'main'
    });
    
    this.addRoute('/chat', ChatView, { 
      requiresAuth: true,
      layout: 'main'
    });
    
    this.addRoute('/chat/:roomId', ChatView, { 
      requiresAuth: true,
      layout: 'main'
    });
    
    // 404 route (must be last)
    this.addRoute('*', NotFoundView, { 
      requiresAuth: false,
      layout: 'default'
    });
  }
  
  init() {
    // Add event listeners
    window.addEventListener('popstate', this.handlePopState);
    document.addEventListener('click', this.handleLinkClick);
    
    // Initial route handling
    this.handleRouteChange();
  }
  
  addRoute(path, viewClass, options = {}) {
    // Convert route path to regex for matching
    const paramNames = [];
    const regexPath = path
      .replace(/([:*])(\w+)/g, (full, colon, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');
    
    this.routes.push({
      path,
      regex: new RegExp(`^${regexPath}$`),
      paramNames,
      view: viewClass,
      requiresAuth: options.requiresAuth !== false,
      layout: options.layout || 'default'
    });
  }
  
  async navigate(path, data = {}, replace = false) {
    // Update browser history
    if (replace) {
      window.history.replaceState(data, '', path);
    } else {
      window.history.pushState(data, '', path);
    }
    
    // Handle the route change
    await this.handleRouteChange();
  }
  
  async handlePopState(event) {
    await this.handleRouteChange();
  }
  
  handleLinkClick(event) {
    // Handle internal link clicks
    const link = event.target.closest('a[href^="/"]');
    
    if (link && !link.target) {
      event.preventDefault();
      this.navigate(link.getAttribute('href'));
    }
  }
  
  async handleRouteChange() {
    const { pathname, search } = window.location;
    
    // Parse query parameters
    this.query = this.parseQueryParams(search);
    
    // Find matching route
    const { route, params } = this.matchRoute(pathname);
    
    if (!route) {
      // No matching route found, show 404
      this.showView(NotFoundView, { path: pathname });
      return;
    }
    
    // Store route params
    this.params = params;
    
    // Check authentication
    if (route.requiresAuth && !this.auth.isAuthenticated()) {
      // Store the intended URL for redirect after login
      const redirectTo = pathname + search;
      this.navigate(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`, {}, true);
      return;
    }
    
    // Show the view
    this.showView(route.view, { ...params, query: this.query });
    
    // Notify app about route change
    if (this.onRouteChange) {
      this.onRouteChange({ route: route.path, params });
    }
  }
  
  matchRoute(path) {
    for (const route of this.routes) {
      const match = path.match(route.regex);
      
      if (match) {
        // Extract parameters from the URL
        const params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = match[i + 1];
        }
        
        return { route, params };
      }
    }
    
    return { route: null, params: {} };
  }
  
  async showView(ViewClass, props = {}) {
    // Clean up current view
    if (this.currentView) {
      this.currentView.destroy();
    }
    
    // Create and render new view
    this.currentView = new ViewClass({
      router: this,
      auth: this.auth,
      ...props
    });
    
    await this.currentView.render();
    
    // Scroll to top on route change
    window.scrollTo(0, 0);
  }
  
  parseQueryParams(search) {
    const params = {};
    
    if (!search) return params;
    
    const queryString = search.startsWith('?') ? search.slice(1) : search;
    const pairs = queryString.split('&');
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    }
    
    return params;
  }
  
  getQueryParam(name) {
    return this.query[name];
  }
  
  getParam(name) {
    return this.params[name];
  }
  
  destroy() {
    // Remove event listeners
    window.removeEventListener('popstate', this.handlePopState);
    document.removeEventListener('click', this.handleLinkClick);
    
    // Clean up current view
    if (this.currentView) {
      this.currentView.destroy();
      this.currentView = null;
    }
  }
}
