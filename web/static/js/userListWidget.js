/**
 * UserListWidget
 * Manages the display and updates of online users in a chat room
 */
class UserListWidget {
    constructor() {
        this.users = new Map();
        this.isVisible = false;
        this.initElements();
        this.bindEvents();
    }

    initElements() {
        this.container = document.getElementById('userListWidget');
        this.toggleButton = document.getElementById('toggleUserListBtn');
        this.userList = document.getElementById('userList');
        this.userCount = document.getElementById('userCount');
    }

    bindEvents() {
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => this.toggleVisibility());
        }
    }

    toggleVisibility() {
        this.isVisible = !this.isVisible;
        this.container.classList.toggle('hidden', !this.isVisible);
        this.toggleButton.classList.toggle('active', this.isVisible);
        
        // Save preference
        if (this.isVisible) {
            localStorage.setItem('userListVisible', 'true');
        } else {
            localStorage.removeItem('userListVisible');
        }
    }

    updateUserList(users) {
        if (!Array.isArray(users)) return;
        
        this.users.clear();
        this.userList.innerHTML = '';
        
        // Sort users alphabetically
        const sortedUsers = [...users].sort((a, b) => a.username.localeCompare(b.username));
        
        sortedUsers.forEach(user => {
            this.addUser(user);
        });
        
        this.updateUserCount();
    }

    addUser(user) {
        if (!user || !user.username || this.users.has(user.username)) return;
        
        this.users.set(user.username, user);
        
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.dataset.username = user.username;
        
        userElement.innerHTML = `
            <span class="user-avatar">${user.username.charAt(0).toUpperCase()}</span>
            <span class="username">${this.escapeHtml(user.username)}</span>
        `;
        
        this.userList.appendChild(userElement);
        this.updateUserCount();
    }

    removeUser(username) {
        if (!username) return;
        
        this.users.delete(username);
        const userElement = this.userList.querySelector(`.user-item[data-username="${username}"]`);
        if (userElement) {
            userElement.remove();
            this.updateUserCount();
        }
    }

    updateUserCount() {
        if (this.userCount) {
            this.userCount.textContent = this.users.size;
        }
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    reset() {
        this.users.clear();
        this.userList.innerHTML = '';
        this.updateUserCount();
    }
}

// Export the UserListWidget class for use in app.js
window.UserListWidget = UserListWidget;
