import { BaseView } from '../../core/BaseView';

export class AuthView extends BaseView {
  constructor({ router, auth }) {
    super();
    this.router = router;
    this.auth = auth;
    this.isLoginView = true;
  }

  async render() {
    this.clearContainer();
    
    const container = document.createElement('div');
    container.className = 'auth-container';
    container.innerHTML = `
      <div class="auth-card">
        <h2>${this.isLoginView ? 'Login' : 'Register'}</h2>
        <div id="authForm" class="auth-form">
          ${this.isLoginView ? this.getLoginForm() : this.getRegisterForm()}
        </div>
        <div class="auth-footer">
          <button id="toggleAuthBtn" class="btn btn-link">
            ${this.isLoginView ? 'Need an account? Register' : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(container);
    this.bindEvents();
  }

  getLoginForm() {
    return `
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" placeholder="Enter your username" required>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" placeholder="Enter your password" required>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Login</button>
    `;
  }

  getRegisterForm() {
    return `
      <div class="form-group">
        <label for="regUsername">Username</label>
        <input type="text" id="regUsername" placeholder="Choose a username" required>
      </div>
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" placeholder="Enter your email" required>
      </div>
      <div class="form-group">
        <label for="regPassword">Password</label>
        <input type="password" id="regPassword" placeholder="Choose a password" required>
      </div>
      <div class="form-group">
        <label for="confirmPassword">Confirm Password</label>
        <input type="password" id="confirmPassword" placeholder="Confirm your password" required>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Register</button>
    `;
  }

  bindEvents() {
    const form = this.container.querySelector('#authForm');
    const toggleBtn = this.container.querySelector('#toggleAuthBtn');

    form.addEventListener('submit', this.handleSubmit.bind(this));
    toggleBtn.addEventListener('click', this.toggleAuthMode.bind(this));
  }

  async handleSubmit(e) {
    e.preventDefault();
    
    try {
      if (this.isLoginView) {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        await this.auth.login({ username, password });
        this.router.navigate('/chat');
      } else {
        const username = document.getElementById('regUsername').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('regPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }

        await this.auth.register({ username, email, password });
        // Auto-login after registration
        await this.auth.login({ username, password });
        this.router.navigate('/chat');
      }
    } catch (error) {
      this.showError(error.message || 'Authentication failed');
    }
  }

  toggleAuthMode() {
    this.isLoginView = !this.isLoginView;
    this.render();
  }

  showError(message) {
    // Show error message to user
    const errorElement = document.createElement('div');
    errorElement.className = 'alert alert-error';
    errorElement.textContent = message;
    
    const form = this.container.querySelector('#authForm');
    form.insertBefore(errorElement, form.firstChild);
    
    // Auto-remove error after 5 seconds
    setTimeout(() => {
      if (errorElement.parentNode === form) {
        form.removeChild(errorElement);
      }
    }, 5000);
  }

  destroy() {
    // Cleanup event listeners
    const form = this.container.querySelector('#authForm');
    const toggleBtn = this.container.querySelector('#toggleAuthBtn');
    
    if (form) {
      form.removeEventListener('submit', this.handleSubmit);
    }
    
    if (toggleBtn) {
      toggleBtn.removeEventListener('click', this.toggleAuthMode);
    }
    
    super.destroy();
  }
}
