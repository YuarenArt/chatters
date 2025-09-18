import { EventEmitter } from '../core/utils/EventEmitter';

export class AuthService extends EventEmitter {
  constructor() {
    super();
    this.currentUser = null;
    this.token = localStorage.getItem('auth_token') || null;
  }

  async init() {
    // Check if we have a valid token on init
    if (this.token) {
      try {
        await this.validateToken();
      } catch (error) {
        console.error('Token validation failed:', error);
        this.logout();
      }
    }
  }

  async login(credentials) {
    try {
      // Replace with actual API call
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data = await response.json();
      this.setAuthData(data);
      this.emit('login', this.currentUser);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async register(userData) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  logout() {
    localStorage.removeItem('auth_token');
    this.token = null;
    this.currentUser = null;
    this.emit('logout');
  }

  isAuthenticated() {
    return !!this.token;
  }

  async validateToken() {
    if (!this.token) return false;

    try {
      const response = await fetch('/api/auth/validate', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        throw new Error('Invalid token');
      }

      const userData = await response.json();
      this.currentUser = userData;
      return true;
    } catch (error) {
      this.logout();
      return false;
    }
  }

  setAuthData({ token, user }) {
    this.token = token;
    this.currentUser = user;
    localStorage.setItem('auth_token', token);
  }
}
