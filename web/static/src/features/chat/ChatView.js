import { BaseView } from '../../core/BaseView';
import { formatDate, escapeHTML } from '../../core/utils/helpers';

export class ChatView extends BaseView {
  constructor({ router, chatService, authService }) {
    super();
    this.router = router;
    this.chatService = chatService;
    this.authService = authService;
    this.messageHandlers = [];
    this.fileTransferManager = null;
  }

  async render() {
    this.clearContainer();

    // Main chat container
    const chatContainer = this.createElement('div', { classes: ['chat-container'] });
    
    // Chat header
    const chatHeader = this.createElement('div', { 
      classes: ['chat-header'],
      parent: chatContainer
    });
    
    // Room info
    const roomInfo = this.createElement('div', { 
      classes: ['room-info'],
      parent: chatHeader
    });
    
    this.roomTitle = this.createElement('h3', { 
      text: 'Loading...',
      parent: roomInfo
    });
    
    this.onlineCount = this.createElement('span', {
      classes: ['online-count'],
      html: '<i class="fas fa-user"></i> <span>0 online</span>',
      parent: roomInfo
    });
    
    // Chat messages area
    this.messagesContainer = this.createElement('div', {
      classes: ['chat-messages'],
      parent: chatContainer
    });
    
    // Message input area
    const messageInputContainer = this.createElement('div', {
      classes: ['message-input-container'],
      parent: chatContainer
    });
    
    // Message input
    this.messageInput = this.createElement('input', {
      attributes: {
        type: 'text',
        placeholder: 'Type your message...',
        id: 'messageInput'
      },
      parent: messageInputContainer
    });
    
    // Send button
    const sendButton = this.createElement('button', {
      classes: ['btn', 'btn-primary'],
      html: '<i class="fas fa-paper-plane"></i>',
      parent: messageInputContainer,
      events: {
        click: () => this.sendMessage()
      }
    });
    
    // File upload button
    const fileInput = this.createElement('input', {
      attributes: {
        type: 'file',
        id: 'fileInput',
        style: 'display: none;'
      },
      parent: messageInputContainer
    });
    
    const uploadButton = this.createElement('button', {
      classes: ['btn', 'btn-outline'],
      html: '<i class="fas fa-paperclip"></i>',
      parent: messageInputContainer,
      events: {
        click: () => fileInput.click()
      }
    });
    
    // Handle file selection
    fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    
    // Handle Enter key for sending messages
    this.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });
    
    // Add chat container to the main container
    this.container.appendChild(chatContainer);
    
    // Initialize chat service event listeners
    this.initializeEventListeners();
    
    // Load initial messages and user list
    await this.loadInitialData();
  }
  
  async loadInitialData() {
    try {
      // Load room info
      const roomInfo = this.chatService.getRoomInfo();
      this.roomTitle.textContent = roomInfo?.name || 'Chat Room';
      
      // Load initial messages
      const messages = this.chatService.getMessages();
      messages.forEach(message => this.addMessageToChat(message));
      
      // Update user list
      this.updateUserList(this.chatService.getUsers());
      
    } catch (error) {
      console.error('Error loading initial data:', error);
      this.showNotification('Error loading chat data', 'error');
    }
  }
  
  initializeEventListeners() {
    // Message received
    const onMessage = (message) => this.addMessageToChat(message);
    this.chatService.on('message', onMessage);
    this.messageHandlers.push({ event: 'message', handler: onMessage });
    
    // User joined
    const onUserJoined = (user) => {
      this.showNotification(`${user.username} joined the chat`, 'info');
      this.updateUserList(this.chatService.getUsers());
    };
    this.chatService.on('user_joined', onUserJoined);
    this.messageHandlers.push({ event: 'user_joined', handler: onUserJoined });
    
    // User left
    const onUserLeft = (user) => {
      this.showNotification(`${user.username} left the chat`, 'info');
      this.updateUserList(this.chatService.getUsers());
    };
    this.chatService.on('user_left', onUserLeft);
    this.messageHandlers.push({ event: 'user_left', handler: onUserLeft });
    
    // User list updated
    const onUserListUpdated = (users) => this.updateUserList(users);
    this.chatService.on('user_list_updated', onUserListUpdated);
    this.messageHandlers.push({ event: 'user_list_updated', handler: onUserListUpdated });
  }
  
  addMessageToChat(message) {
    const messageElement = this.createMessageElement(message);
    this.messagesContainer.appendChild(messageElement);
    this.scrollToBottom();
  }
  
  createMessageElement(message) {
    const isCurrentUser = message.senderId === this.authService.currentUser?.id;
    const messageClass = isCurrentUser ? 'message-outgoing' : 'message-incoming';
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageClass}`;
    
    // Format message content based on type
    let content = '';
    if (message.type === 'file') {
      content = `
        <div class="message-file">
          <i class="fas fa-file"></i>
          <span>${escapeHTML(message.content.name)}</span>
          <span class="file-size">(${this.formatFileSize(message.content.size)})</span>
          <a href="#" class="download-link" data-url="${message.content.url}">Download</a>
        </div>
      `;
    } else {
      content = `<div class="message-text">${escapeHTML(message.content)}</div>`;
    }
    
    messageElement.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${message.sender || 'System'}</span>
        <span class="message-time">${formatDate(message.timestamp)}</span>
      </div>
      <div class="message-content">
        ${content}
      </div>
    `;
    
    return messageElement;
  }
  
  async sendMessage() {
    const content = this.messageInput.value.trim();
    if (!content) return;
    
    try {
      await this.chatService.sendMessage(content);
      this.messageInput.value = '';
      this.messageInput.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      this.showNotification('Failed to send message', 'error');
    }
  }
  
  async handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Reset file input
    event.target.value = '';
    
    try {
      // Show upload indicator
      const uploadIndicator = this.showNotification('Uploading file...', 'info', 0);
      
      // Send file (implementation depends on your backend)
      await this.chatService.sendFile(file);
      
      // Update UI
      if (uploadIndicator && uploadIndicator.parentNode) {
        this.container.removeChild(uploadIndicator);
      }
      this.showNotification('File sent successfully', 'success');
      
    } catch (error) {
      console.error('Error sending file:', error);
      this.showNotification('Failed to send file', 'error');
    }
  }
  
  updateUserList(users) {
    this.onlineCount.innerHTML = `<i class="fas fa-user"></i> <span>${users.length} online</span>`;
    // You can add more detailed user list UI updates here
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
  
  destroy() {
    // Remove all event listeners
    this.messageHandlers.forEach(({ event, handler }) => {
      this.chatService.off(event, handler);
    });
    this.messageHandlers = [];
    
    // Clean up file transfer manager if it exists
    if (this.fileTransferManager) {
      this.fileTransferManager.destroy();
      this.fileTransferManager = null;
    }
    
    super.destroy();
  }
}
