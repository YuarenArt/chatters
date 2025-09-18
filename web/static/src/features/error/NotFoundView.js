import { BaseView } from '../../core/BaseView';

export class NotFoundView extends BaseView {
  constructor({ router, auth, path }) {
    super();
    this.router = router;
    this.auth = auth;
    this.path = path;
  }

  async render() {
    this.clearContainer();
    
    const container = this.createElement('div', { 
      classes: ['not-found-container', 'text-center', 'py-5'] 
    });
    
    container.innerHTML = `
      <div class="error-code">404</div>
      <h1 class="display-4">Page Not Found</h1>
      <p class="lead">The requested URL <code>${this.path || window.location.pathname}</code> was not found on this server.</p>
      <div class="mt-4">
        <button id="goBackBtn" class="btn btn-primary mr-2">
          <i class="fas fa-arrow-left mr-2"></i>Go Back
        </button>
        <a href="/" class="btn btn-outline-primary">
          <i class="fas fa-home mr-2"></i>Go to Homepage
        </a>
      </div>
    `;
    
    this.container.appendChild(container);
    this.bindEvents();
  }
  
  bindEvents() {
    const goBackBtn = this.container.querySelector('#goBackBtn');
    if (goBackBtn) {
      goBackBtn.addEventListener('click', () => window.history.back());
    }
  }
  
  destroy() {
    const goBackBtn = this.container.querySelector('#goBackBtn');
    if (goBackBtn) {
      goBackBtn.removeEventListener('click', () => window.history.back());
    }
    
    super.destroy();
  }
}
