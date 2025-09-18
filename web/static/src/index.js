// Main application entry point
import { App } from './App';
import './styles/main.css';

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
