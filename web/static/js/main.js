// Application configuration
const CONFIG = {
    API_BASE_URL: 'http://localhost:8080/api',
    WS_BASE_URL: 'ws://localhost:8080/ws',
    RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 1000,
    MAX_MESSAGE_LENGTH: 1000,
    MAX_USERNAME_LENGTH: 25
};

window.ChattersApp = {
    config: CONFIG,
    widgets: {},
    state: {
        isInitialized: false,
        currentRoom: null,
        username: null
    }
};

async function initializeApp() {
    try {
        console.log('Initializing Chatters application...');

        // Wait for DOM to load
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }

        await waitForElements();

        bindGlobalEvents();
        loadStoredData();
        showConnectionForm();

        window.ChattersApp.state.isInitialized = true;

        console.log('Application successfully initialized');

    } catch (error) {
        console.error('Application initialization error:', error);
        showGlobalError('Initialization Error', 'Failed to start application');
    }
}

// Wait for required elements to load
async function waitForElements() {
    const requiredElements = [
        'connectionForm',
        'chatRoom',
        'createRoomModal',
        'notifications'
    ];

    for (const elementId of requiredElements) {
        await waitForElement(elementId);
    }
}

// Wait for element to appear
function waitForElement(elementId, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const element = document.getElementById(elementId);
        if (element) {
            resolve(element);
            return;
        }

        const timeoutId = setTimeout(() => {
            reject(new Error(`Element #${elementId} not found within ${timeout}ms`));
        }, timeout);

        const observer = new MutationObserver((mutations, obs) => {
            const element = document.getElementById(elementId);
            if (element) {
                clearTimeout(timeoutId);
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

// Bind global events
function bindGlobalEvents() {

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('Global events bound');
}

// Handle global errors
function handleGlobalError(event) {
    console.error('Global error:', event.error);
    showGlobalError('System Error', 'An unexpected error occurred');
}

// Handle unhandled promise rejections
function handleUnhandledRejection(event) {
    console.error('Unhandled promise rejection:', event.reason);
    showGlobalError('Operation Error', 'Operation failed with error');
}

// Handle page close
function handleBeforeUnload(event) {
    if (window.ChattersApp.widgets.chat?.isConnected) {
        window.ChattersApp.widgets.chat.disconnect();
    }
}

// Handle page visibility change
function handleVisibilityChange() {
    if (document.hidden) {
        console.log('Page hidden');
    } else {
        console.log('Page visible');
    }
}

// Load data from storage
function loadStoredData() {
    try {
        const username = localStorage.getItem('chatters_username');
        if (username) {
            const usernameInput = document.getElementById('username');
            if (usernameInput) {
                usernameInput.value = username;
                window.ChattersApp.state.username = username;
            }
        }
        console.log('Storage data loaded');
    } catch (error) {
        console.warn('Failed to load storage data:', error);
    }
}

// Show connection form
function showConnectionForm() {
    const connectionForm = document.getElementById('connectionForm');
    const chatRoom = document.getElementById('chatRoom');

    if (connectionForm) connectionForm.classList.remove('hidden');
    if (chatRoom) chatRoom.classList.add('hidden');
}

// Show global error using notification system
function showGlobalError(title, message) {
    if (window.notificationSystem) {
        window.notificationSystem.error(title, message);
    } else {
        console.error(`[ERROR] ${title}: ${message}`);
    }
}

// Check if application is ready
function isAppReady() {
    return window.ChattersApp.state.isInitialized;
}

// Export utility functions to global scope
window.ChattersApp.utils = {
    isAppReady,
    showConnectionForm,
    showGlobalError
};

// Start initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
