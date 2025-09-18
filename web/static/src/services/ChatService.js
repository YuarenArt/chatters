import { EventEmitter } from '../core/utils/EventEmitter';

export class ChatService extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.room = null;
    this.messages = [];
    this.users = new Map();
  }

  async init() {
    // Initialize WebSocket connection when needed
    // The actual connection will be established when joining a room
  }

  async joinRoom(roomId, username, password = '') {
    if (this.socket) {
      this.leaveRoom();
    }

    return new Promise((resolve, reject) => {
      try {
        // Create WebSocket connection
        const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/${roomId}?username=${encodeURIComponent(username)}${password ? `&password=${encodeURIComponent(password)}` : ''}`;
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
          this.room = { id: roomId, name: `Room #${roomId}` };
          this.emit('connected');
          resolve();
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.socket.onclose = (event) => {
          this.emit('disconnected', event);
          this.cleanup();
        };

        this.socket.onerror = (error) => {
          this.emit('error', error);
          reject(error);
        };
      } catch (error) {
        console.error('Error joining room:', error);
        reject(error);
      }
    });
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.close();
      this.cleanup();
    }
  }

  sendMessage(content, type = 'text') {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to chat');
    }

    const message = {
      type: 'message',
      data: {
        content,
        type,
        timestamp: new Date().toISOString()
      }
    };

    this.socket.send(JSON.stringify(message));
  }

  handleMessage(message) {
    switch (message.type) {
      case 'message':
        this.messages.push(message.data);
        this.emit('message', message.data);
        break;
      
      case 'user_joined':
        this.users.set(message.data.userId, message.data);
        this.emit('user_joined', message.data);
        break;
      
      case 'user_left':
        this.users.delete(message.data.userId);
        this.emit('user_left', message.data);
        break;
      
      case 'user_list':
        this.updateUserList(message.data.users);
        break;
      
      case 'error':
        this.emit('error', message.data);
        break;
      
      default:
        console.warn('Unhandled message type:', message.type);
    }
  }

  updateUserList(users) {
    this.users = new Map(users.map(user => [user.id, user]));
    this.emit('user_list_updated', Array.from(this.users.values()));
  }

  getRoomInfo() {
    return this.room;
  }

  getMessages() {
    return [...this.messages];
  }

  getUsers() {
    return Array.from(this.users.values());
  }

  cleanup() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      
      this.socket = null;
    }
    
    this.room = null;
    this.messages = [];
    this.users.clear();
  }

  // File transfer methods
  async sendFile(file) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to chat');
    }

    // For large files, we'd implement chunked upload here
    // For now, we'll just send a message with file metadata
    const fileMessage = {
      type: 'file',
      data: {
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: new Date().toISOString()
      }
    };

    this.socket.send(JSON.stringify(fileMessage));
    return fileMessage.data;
  }
}
