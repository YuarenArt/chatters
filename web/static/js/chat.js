// chat.js
// English comments in code per user requirement.

/* ChatWidget with robust element binding and FileTransferManager integration.
   Fixes:
   - Wait only for core elements, create optional file UI if missing to avoid timeouts.
   - Adds missing addSystemMessage method used by handleMessage.
   - Keeps file transfer logic intact.
*/

class FileTransferManager {
    constructor(ws, username, uiHandlers) {
        this.ws = ws;
        this.username = username;
        this.ui = uiHandlers || {};
        this.availableFiles = new Map();
        this.transfers = new Map();
        this.peerConns = new Map();
        this.iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.chunkSize = 16 * 1024;

    }

    generateId() {
        return 't_' + Math.random().toString(36).slice(2, 12);
    }

    announceFile(file) {
        const transferId = this.generateId();
        const meta = {
            transferId,
            owner: this.username,
            filename: file.name,
            filesize: file.size,
            mime: file.type || 'application/octet-stream'
        };
        this.availableFiles.set(transferId, meta);
        this.sendSignaling('file-available', meta);
        if (this.ui.onAvailableFilesUpdated) this.ui.onAvailableFilesUpdated(this.getAvailableList());
        this.transfers.set(transferId, { owner: this.username, file, meta, peers: new Map() });
        return transferId;
    }

    getAvailableList() {
        return Array.from(this.availableFiles.values());
    }

    requestFile(transferId, owner) {
        const payload = { transferId, owner, from: this.username };
        this.sendSignaling('request-file', payload);
        if (this.ui.showNotification) this.ui.showNotification('Request sent', `Requested file ${transferId} from ${owner}`, 'info');
    }

    async handleSignaling(msg) {
        // msg: { type, data }
        if (!msg || !msg.type) return;
        const type = msg.type;
        const data = msg.data || {};
        switch (type) {
            case 'file-available':
                this.handleFileAvailable(data);
                break;
            case 'request-file':
                await this.handleRequestFile(data);
                break;
            case 'offer':
                await this.handleOffer(data);
                break;
            case 'answer':
                await this.handleAnswer(data);
                break;
            case 'ice-candidate':
                await this.handleRemoteIce(data);
                break;
            default:
                // ignore
                break;
        }
    }

    handleFileAvailable(data) {
        if (!data || !data.transferId || !data.owner) return;
        if (data.owner === this.username) return;
        this.availableFiles.set(data.transferId, data);
        if (this.ui.onAvailableFilesUpdated) this.ui.onAvailableFilesUpdated(this.getAvailableList());
    }

    async handleRequestFile(data) {
        if (!data || !data.transferId || !data.owner || !data.from) return;
        if (data.owner !== this.username) return;
        const transfer = this.transfers.get(data.transferId);
        if (!transfer) {
            console.warn('No transfer found for request', data.transferId);
            return;
        }
        const requester = data.from;
        const key = data.transferId + '|' + requester;
        if (this.peerConns.has(key)) return;

        const pc = new RTCPeerConnection(this.iceConfig);
        const dc = pc.createDataChannel('file-' + data.transferId);
        this.peerConns.set(key, { pc, dc, role: 'owner', meta: transfer.meta, file: transfer.file });

        this.setupOwnerDataChannel(dc, data.transferId, requester, key);
        this.setupPCIce(pc, data.transferId, requester);

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            const payload = {
                transferId: data.transferId,
                sdp: offer.sdp,
                type: offer.type,
                to: requester,
                from: this.username
            };
            this.sendSignaling('offer', payload);
        } catch (err) {
            console.error('Error creating offer for file transfer', err);
        }
    }

    async handleOffer(data) {
        if (!data || !data.sdp || !data.transferId) return;
        if (data.to && data.to !== this.username) return;
        const owner = data.from;
        const transferId = data.transferId;
        const key = transferId + '|' + owner;
        if (this.peerConns.has(key)) return;

        const pc = new RTCPeerConnection(this.iceConfig);
        pc.ondatachannel = (ev) => {
            const dc = ev.channel;
            this.setupReceiverDataChannel(dc, transferId, owner, key);
            const recObj = this.peerConns.get(key) || {};
            recObj.dc = dc;
            this.peerConns.set(key, recObj);
        };

        this.setupPCIce(pc, transferId, owner);

        try {
            const desc = { type: data.type || 'offer', sdp: data.sdp };
            await pc.setRemoteDescription(desc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const payload = {
                transferId,
                sdp: answer.sdp,
                type: answer.type,
                to: owner,
                from: this.username
            };
            this.peerConns.set(key, { pc, role: 'requester', meta: { transferId, owner } });
            this.sendSignaling('answer', payload);
        } catch (err) {
            console.error('Error handling offer for file transfer', err);
        }
    }

    async handleAnswer(data) {
        if (!data || !data.sdp || !data.transferId) return;
        if (data.to && data.to !== this.username) return;
        const requester = data.from;
        const transferId = data.transferId;
        const key = transferId + '|' + requester;
        const entry = this.peerConns.get(key);
        if (!entry) {
            console.warn('No owner-side peer connection found for answer', key);
            return;
        }
        try {
            const desc = { type: data.type || 'answer', sdp: data.sdp };
            await entry.pc.setRemoteDescription(desc);
        } catch (err) {
            console.error('Error setting remote description for owner after answer', err);
        }
    }

    async handleRemoteIce(data) {
        if (!data || !data.transferId || !data.candidate) return;
        if (data.to && data.to !== this.username) return;
        const peer = data.from || data.peer;
        const key1 = data.transferId + '|' + peer;
        const key2 = data.transferId + '|' + data.to;
        let entry = this.peerConns.get(key1) || this.peerConns.get(key2);
        if (!entry) {
            const t = this.transfers.get(data.transferId) || {};
            t.pendingCandidates = t.pendingCandidates || [];
            t.pendingCandidates.push(data);
            this.transfers.set(data.transferId, t);
            return;
        }
        try {
            await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('Failed to add remote ice candidate', err);
        }
    }

    setupPCIce(pc, transferId, peerUsername) {
        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                const payload = {
                    transferId,
                    candidate: ev.candidate,
                    from: this.username,
                    to: peerUsername
                };
                this.sendSignaling('ice-candidate', payload);
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                for (const [k, v] of this.peerConns.entries()) {
                    if (v.pc === pc) {
                        this.peerConns.delete(k);
                        if (this.ui.onTransferProgress) this.ui.onTransferProgress(k, 0, 'closed');
                    }
                }
            }
        };
    }

    setupOwnerDataChannel(dc, transferId, requester, key) {
        dc.binaryType = 'arraybuffer';
        dc.onopen = async () => {
            const entry = this.peerConns.get(key);
            if (!entry || !entry.file) {
                console.error('No file found to send for', key);
                return;
            }
            const file = entry.file;
            const meta = JSON.stringify({ type: 'file-meta', filename: file.name, filesize: file.size, mime: file.type });
            dc.send(meta);
            const reader = new FileReader();
            let offset = 0;
            const chunkSize = this.chunkSize;
            while (offset < file.size) {
                const slice = file.slice(offset, offset + chunkSize);
                const buf = await new Promise((resolve, reject) => {
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(e);
                    reader.readAsArrayBuffer(slice);
                });
                try {
                    dc.send(buf);
                } catch (err) {
                    console.error('Error sending chunk', err);
                    break;
                }
                offset += chunkSize;
                if (this.ui.onTransferProgress) {
                    const progress = Math.min(1, offset / file.size);
                    this.ui.onTransferProgress(transferId, progress, 'sending', requester);
                }
                await this._sleep(10);
            }
            dc.send(JSON.stringify({ type: 'file-end' }));
            if (this.ui.onTransferProgress) this.ui.onTransferProgress(transferId, 1, 'completed', requester);
            if (this.ui.onTransferComplete) this.ui.onTransferComplete(transferId, file.name, file.size, requester);
        };

        dc.onclose = () => {
            const pc = this.peerConns.get(key)?.pc;
            if (pc) pc.close();
            this.peerConns.delete(key);
        };

        dc.onerror = (ev) => {
            console.error('DataChannel error (owner)', ev);
        };
    }

    setupReceiverDataChannel(dc, transferId, owner, key) {
        dc.binaryType = 'arraybuffer';
        let incomingBuffers = [];
        let receivedBytes = 0;
        let expectedSize = null;
        let filename = 'file';

        dc.onopen = () => {
            if (this.ui.onTransferProgress) this.ui.onTransferProgress(transferId, 0, 'receiving', owner);
        };

        dc.onmessage = (ev) => {
            const data = ev.data;
            // string control messages
            if (typeof data === 'string') {
                try {
                    const obj = JSON.parse(data);
                    if (obj.type === 'file-meta') {
                        // store meta locally (in peerConns entry) for filename/filesize
                        const rec = this.peerConns.get(key) || {};
                        rec._meta = { filename: obj.filename || 'file', filesize: obj.filesize || null, mime: obj.mime || 'application/octet-stream' };
                        this.peerConns.set(key, rec);

                        // initialize worker with metadata
                        if (this.transferWorker) {
                            this.transferWorker.postMessage({
                                type: 'init',
                                filename: rec._meta.filename,
                                filesize: rec._meta.filesize,
                                mime: rec._meta.mime
                            });
                        }
                        if (this.ui.onTransferProgress) this.ui.onTransferProgress(transferId, 0, 'receiving-meta', owner, { filename: rec._meta.filename });
                    } else if (obj.type === 'file-end') {
                        // tell worker to finish and assemble
                        if (this.transferWorker) {
                            this.transferWorker.postMessage({ type: 'finish' });
                        } else {
                            // fallback: if no worker, assemble locally (not recommended for large files)
                            console.warn('No transfer worker - cannot assemble efficiently');
                            if (this.ui.showNotification) this.ui.showNotification('Error', 'No transfer worker available', 'error');
                        }
                        // cleanup pc handled by worker message handler when file-complete arrives
                    }
                } catch (err) {
                    console.warn('Unknown string message on data channel', data);
                }
            } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
                // ensure we have an ArrayBuffer
                const buf = data instanceof ArrayBuffer ? data : data.buffer;
                // forward chunk to worker (transfer ownership)
                if (this.transferWorker) {
                    try {
                        this.transferWorker.postMessage({ type: 'chunk', buf: buf }, [buf]);
                    } catch (err) {
                        // if transfer fails, try without transfer
                        this.transferWorker.postMessage({ type: 'chunk', buf: buf });
                    }
                } else {
                    // fallback: accumulate locally (simple)
                    const rec = this.peerConns.get(key) || {};
                    rec._localChunks = rec._localChunks || [];
                    rec._localChunks.push(buf);
                    rec._localBytes = (rec._localBytes || 0) + buf.byteLength;
                    this.peerConns.set(key, rec);
                    if (this.ui.onTransferProgress) {
                        const expected = rec._meta?.filesize || null;
                        const progress = expected ? Math.min(1, rec._localBytes / expected) : null;
                        this.ui.onTransferProgress(transferId, progress, 'receiving-chunk', owner, { receivedBytes: rec._localBytes });
                    }
                }
            } else {
                console.warn('Unknown data type on datachannel', typeof data);
            }
        };

        dc.onclose = () => { /* noop */ };
        dc.onerror = (ev) => console.error('DataChannel error (receiver)', ev);
    }

    _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    sendSignaling(type, data) {
        try {
            const msg = { type, data };
            this.ws.send(JSON.stringify(msg));
        } catch (err) {
            console.error('Failed to send signaling message', err);
        }
    }

    removeAvailableTransfer(transferId) {
        this.availableFiles.delete(transferId);
        this.transfers.delete(transferId);
        if (this.ui.onAvailableFilesUpdated) this.ui.onAvailableFilesUpdated(this.getAvailableList());
    }
}

/* ChatWidget implementation */
class ChatWidget {
    constructor() {
        this.ws = null;
        this.currentRoom = null;
        this.username = '';
        this.isConnected = false;
        this.isInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = window.ChattersApp?.config?.RECONNECT_ATTEMPTS || 5;
        this.reconnectDelay = window.ChattersApp?.config?.RECONNECT_DELAY || 1000;
        this.fileManager = null;
        this.init();
    }

    init() {
        try {
            this.bindEvents();
            this.isInitialized = true;
            console.log('ChatWidget initialized');
        } catch (error) {
            console.error('ChatWidget initialization error:', error);
            this.showNotification('Error', 'Failed to initialize chat', 'error');
        }
    }

    bindEvents() {
        this.waitForElements().then(() => {
            this.attachEventListeners();
        }).catch(error => {
            console.error('Failed to bind ChatWidget events:', error);
            this.showNotification('Error', error.message || 'Failed to bind chat events', 'error');
        });
    }

    // Wait only for CORE elements; create optional file UI elements if missing to avoid timeouts
    async waitForElements() {
        const coreElements = [
            'leaveBtn',
            'sendBtn',
            'messageInput',
            'chatMessages',
            'currentRoomId',
            'onlineCount'
        ];

        // Wait up to 6 seconds for core elements (usually exist)
        const waitFor = (id, timeout = 6000) => {
            return new Promise((resolve, reject) => {
                const el = document.getElementById(id);
                if (el) return resolve(el);
                const timeoutId = setTimeout(() => {
                    reject(new Error(`Element #${id} not found within ${timeout}ms`));
                }, timeout);
                const observer = new MutationObserver((mutations, obs) => {
                    const found = document.getElementById(id);
                    if (found) {
                        clearTimeout(timeoutId);
                        obs.disconnect();
                        resolve(found);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
            });
        };

        // Wait core elements
        for (const id of coreElements) {
            await waitFor(id);
        }

        // Ensure file UI exists; if not — create it dynamically (so widget won't fail)
        this.ensureFileUI();
    }

    // Create upload button, file input and file panel if missing
    ensureFileUI() {
        try {
            const header = document.querySelector('.chat-header');
            if (!header) {
                console.warn('Chat header not found; cannot attach upload UI automatically');
            } else {
                if (!document.getElementById('uploadFileBtn')) {
                    const uploadBtn = document.createElement('button');
                    uploadBtn.id = 'uploadFileBtn';
                    uploadBtn.className = 'btn btn-outline';
                    uploadBtn.title = 'Upload file';
                    uploadBtn.innerHTML = '<i class="fas fa-upload"></i>';
                    // place before leaveBtn if leave exists
                    const leaveBtn = document.getElementById('leaveBtn');
                    if (leaveBtn && leaveBtn.parentNode) {
                        leaveBtn.parentNode.insertBefore(uploadBtn, leaveBtn);
                    } else {
                        header.appendChild(uploadBtn);
                    }
                }
            }

            if (!document.getElementById('fileInput')) {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.id = 'fileInput';
                fileInput.className = 'hidden';
                document.body.appendChild(fileInput);
            }

            if (!document.getElementById('fileTransfersPanel')) {
                const chatRoom = document.getElementById('chatRoom') || document.querySelector('.chat-room');
                if (chatRoom) {
                    const panel = document.createElement('div');
                    panel.id = 'fileTransfersPanel';
                    panel.className = 'file-transfers-panel';
                    panel.innerHTML = `<h4>Available files</h4><ul id="availableFilesList"></ul><h4>Transfers</h4><ul id="activeTransfersList"></ul>`;
                    chatRoom.appendChild(panel);
                }
            }

        } catch (err) {
            console.error('Failed to ensure file UI', err);
        }
    }

    attachEventListeners() {
        try {
            const leaveBtn = document.getElementById('leaveBtn');
            const sendBtn = document.getElementById('sendBtn');
            const messageInput = document.getElementById('messageInput');
            const uploadBtn = document.getElementById('uploadFileBtn');
            const fileInput = document.getElementById('fileInput');

            if (leaveBtn) {
                leaveBtn.addEventListener('click', () => this.leaveRoom());
            }

            if (sendBtn) {
                sendBtn.addEventListener('click', () => this.sendMessage());
                sendBtn.disabled = !this.isConnected;
            }

            if (messageInput) {
                messageInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                });
                messageInput.disabled = !this.isConnected;
            }

            if (uploadBtn && fileInput) {
                uploadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', (e) => this.handleFileSelected(e.target.files));
            }

            console.log('ChatWidget events bound');
        } catch (error) {
            console.error('Error binding ChatWidget events:', error);
            this.showNotification('Error', 'Failed to bind chat events', 'error');
        }
    }

    async joinRoom(roomId, username) {
        try {
            if (!roomId || !username) throw new Error('Room ID or username not specified');

            if (this.isConnected && this.currentRoom === roomId && this.username === username) {
                this.showNotification('Info', 'Already connected to this room', 'info');
                return;
            }

            if (this.ws && this.isConnected) this.leaveRoom();

            this.currentRoom = roomId;
            this.username = username;
            await this.connectWebSocket(roomId, username);
            console.log('Joining room:', roomId, 'as', username);
        } catch (error) {
            console.error('Error joining room:', error);
            this.showNotification('Error', error.message || 'Failed to join room', 'error');
        }
    }

    async connectWebSocket(roomId, username) {

        if (typeof RTCPeerConnection === 'undefined') {
            this.showNotification('Error', 'WebRTC not supported in this browser', 'error');
            console.error('RTCPeerConnection is not available in this environment');
            return;
        }

        try {
            const wsUrl = `${window.ChattersApp.config.WS_BASE_URL}/${roomId}?username=${encodeURIComponent(username)}`;
            console.log('Connecting to WebSocket:', wsUrl);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.showChatRoom();

                const roomIdElement = document.getElementById('currentRoomId');
                if (roomIdElement) roomIdElement.textContent = roomId;

                this.updateUIState();

                try {
                    if (typeof Worker !== 'undefined') {
                        this.transferWorker = new Worker('/static/js/worker.js');
                        console.log('Transfer worker created');
                        this.transferWorker.onmessage = (ev) => {
                            const m = ev.data;
                            if (!m || !m.type) return;
                            if (m.type === 'file-complete') {
                                try {
                                    const arrayBuffer = m.buffer;
                                    const blob = new Blob([arrayBuffer], { type: m.mime || 'application/octet-stream' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = m.filename || 'download';
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    URL.revokeObjectURL(url);
                                    this.showNotification('Download complete', `${m.filename} (${Math.round((m.filesize||0)/1024)} KB)`, 'success');
                                } catch (err) {
                                    console.error('Error handling file-complete from worker', err);
                                    this.showNotification('Error', 'Failed to assemble downloaded file', 'error');
                                }
                            } else if (m.type === 'error') {
                                console.error('Worker error:', m.message);
                                this.showNotification('Error', m.message || 'Worker error', 'error');
                            }
                        };
                    } else {
                        this.transferWorker = null;
                        console.warn('Web Worker not supported in this environment');
                    }
                } catch (err) {
                    console.warn('Cannot create transfer worker:', err);
                    this.transferWorker = null;
                }

                // initialize file manager after ws is ready -- pass worker reference into it
                this.fileManager = new FileTransferManager(this.ws, this.username, {
                    onAvailableFilesUpdated: (list) => this.renderAvailableFiles(list),
                    onTransferProgress: (transferId, progress, status, peer, extra) => this.renderTransferProgress(transferId, progress, status, peer, extra),
                    onTransferComplete: (transferId, filename, bytes, peer) => this.onTransferComplete(transferId, filename, bytes, peer),
                    showNotification: (title, message, type) => this.showNotification(title, message, type)
                });

                // make worker available inside fileManager (so fileManager can postMessage to worker)
                if (this.transferWorker) {
                    this.fileManager.transferWorker = this.transferWorker;
                }

                this.showNotification('Connected!', `You joined room #${roomId}`, 'success');
                console.log('WebSocket connected');
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    // file signaling first
                    if (this.fileManager) {
                        // don't await to avoid blocking; errors logged
                        this.fileManager.handleSignaling(message).catch(e => console.error(e));
                    }
                    // then chat
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                    this.showNotification('Error', 'Invalid message received', 'error');
                }
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;
                this.updateUIState();
                console.log('WebSocket closed:', event.code, event.reason);
                if (!event.wasClean) this.handleReconnect();
            };

            this.ws.onerror = (error) => {
                this.isConnected = false;
                this.updateUIState();
                console.error('WebSocket error:', error);
                this.showNotification('Error', 'Chat connection error', 'error');
            };
        } catch (error) {
            console.error('Error creating WebSocket:', error);
            this.showNotification('Error', 'Failed to create connection', 'error');
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.showNotification('Reconnecting...', `Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, 'info');
            setTimeout(() => {
                if (this.currentRoom && this.username) {
                    this.connectWebSocket(this.currentRoom, this.username);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.showNotification('Error', 'Failed to reconnect. Please try again.', 'error');
            this.leaveRoom();
        }
    }

    handleMessage(message) {
        try {
            switch (message.type) {
                case 'chat':
                    this.addChatMessage(message.data);
                    break;
                case 'join':
                    // ensure addSystemMessage exists
                    this.addSystemMessage(`${message.data.username} joined the chat`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'leave':
                    this.addSystemMessage(`${message.data.username} left the chat`);
                    this.updateOnlineCount(message.data.onlineCount);
                    break;
                case 'error':
                    this.showNotification('Error', message.data.message || 'Server error', 'error');
                    if (message.data.message && message.data.message.includes('username already taken')) {
                        this.leaveRoom();
                    }
                    break;
                default:
                // no-op for other types
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.showNotification('Error', 'Failed to process message', 'error');
        }
    }

    addChatMessage(data) {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (!messagesContainer) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${data.username === this.username ? 'own' : ''}`;

            const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <span class="username">${this.escapeHtml(data.username)}</span>
                        <span class="timestamp">${timestamp}</span>
                    </div>
                    <div class="message-text">${this.escapeHtml(data.text)}</div>
                </div>
            `;

            messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
        } catch (error) {
            console.error('Error adding chat message:', error);
            this.showNotification('Error', 'Failed to display message', 'error');
        }
    }

    // Reintroduced function that was missing (fixes TypeError)
    addSystemMessage(text) {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (!messagesContainer) return;
            const messageDiv = document.createElement('div');
            messageDiv.className = 'system-message';
            messageDiv.textContent = text;
            messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
        } catch (err) {
            console.error('Error adding system message', err);
        }
    }

    // File selection handler
    handleFileSelected(fileList) {
        try {
            if (!fileList || fileList.length === 0) return;
            const file = fileList[0];
            if (!this.fileManager) {
                this.showNotification('Error', 'File system not ready', 'error');
                return;
            }
            const transferId = this.fileManager.announceFile(file);
            this.showNotification('File announced', `${file.name} is available for download`, 'success');
            this.renderAvailableFiles(this.fileManager.getAvailableList());
            const fi = document.getElementById('fileInput');
            if (fi) fi.value = '';
        } catch (err) {
            console.error('File select error', err);
            this.showNotification('Error', 'Failed to select file', 'error');
        }
    }

    renderAvailableFiles(list) {
        try {
            const ul = document.getElementById('availableFilesList');
            if (!ul) return;
            ul.innerHTML = '';
            list.forEach(item => {
                const li = document.createElement('li');
                li.className = 'available-file';
                li.dataset.transferId = item.transferId;
                li.innerHTML = `
                    <div class="file-item">
                        <div class="file-meta">
                            <strong>${this.escapeHtml(item.filename)}</strong>
                            <span class="file-owner">from ${this.escapeHtml(item.owner)}</span>
                            <span class="file-size">(${Math.round((item.filesize||0)/1024)} KB)</span>
                        </div>
                        <div class="file-actions">
                            <button class="btn btn-sm btn-primary download-file-btn">Download</button>
                        </div>
                    </div>
                `;
                const btn = li.querySelector('.download-file-btn');
                btn.addEventListener('click', () => {
                    this.fileManager.requestFile(item.transferId, item.owner);
                    this.addPendingTransferUI(item.transferId, item.filename, item.owner);
                });
                ul.appendChild(li);
            });
        } catch (err) {
            console.error('Failed to render available files', err);
        }
    }

    addPendingTransferUI(transferId, filename, owner) {
        const ul = document.getElementById('activeTransfersList');
        if (!ul) return;
        const li = document.createElement('li');
        li.id = `transfer-${transferId}`;
        li.innerHTML = `
            <div class="transfer-item">
                <div class="transfer-meta">
                    <strong>${this.escapeHtml(filename)}</strong>
                    <span class="transfer-peer">from ${this.escapeHtml(owner)}</span>
                </div>
                <div class="transfer-progress">
                    <progress value="0" max="1"></progress>
                    <span class="transfer-status">pending</span>
                </div>
            </div>
        `;
        ul.appendChild(li);
    }

    renderTransferProgress(transferId, progress, status, peer, extra) {
        try {
            const li = document.getElementById(`transfer-${transferId}`);
            if (!li) return;
            const progressEl = li.querySelector('progress');
            const statusEl = li.querySelector('.transfer-status');
            if (progressEl && progress !== null && progress !== undefined) progressEl.value = progress;
            if (statusEl) statusEl.textContent = status;
            if (extra && extra.filename && !li.querySelector('.transfer-filename')) {
                const metaDiv = li.querySelector('.transfer-meta');
                metaDiv.innerHTML += `<div class="transfer-filename">${this.escapeHtml(extra.filename)}</div>`;
            }
        } catch (err) {
            console.error('Error updating transfer UI', err);
        }
    }

    onTransferComplete(transferId, filename, bytes, peer) {
        try {
            const li = document.getElementById(`transfer-${transferId}`);
            if (li) {
                const statusEl = li.querySelector('.transfer-status');
                if (statusEl) statusEl.textContent = 'completed';
            }
        } catch (err) {
            console.error('Error on transfer complete', err);
        }
    }

    sendMessage() {
        try {
            const input = document.getElementById('messageInput');
            if (!input || !this.isConnected) {
                this.showNotification('Error', 'Not connected to chat', 'error');
                return;
            }
            const text = input.value.trim();
            if (!text) return;
            const maxLength = window.ChattersApp?.config?.MAX_MESSAGE_LENGTH || 1000;
            if (text.length > maxLength) {
                this.showNotification('Error', `Message must be less than ${maxLength} characters`, 'error');
                return;
            }
            const message = { type: 'chat', data: { text: text } };
            this.ws.send(JSON.stringify(message));
            input.value = '';
            console.log('Message sent');
        } catch (error) {
            console.error('Error sending message:', error);
            this.showNotification('Error', 'Failed to send message', 'error');
        }
    }

    leaveRoom() {
        try {
            if (this.ws) {
                this.ws.close(1000, 'User left');
                this.ws = null;
            }
            this.isConnected = false;
            this.currentRoom = null;
            this.reconnectAttempts = 0;
            const messagesContainer = document.getElementById('chatMessages');
            const messageInput = document.getElementById('messageInput');
            const sendBtn = document.getElementById('sendBtn');
            if (messagesContainer) messagesContainer.innerHTML = '';
            if (messageInput) {
                messageInput.value = '';
                messageInput.disabled = true;
            }
            if (sendBtn) sendBtn.disabled = true;
            if (window.ChattersApp?.utils) window.ChattersApp.utils.showConnectionForm();
            this.showNotification('Info', 'You left the chat', 'info');
            console.log('User left room');
        } catch (error) {
            console.error('Error leaving room:', error);
            this.showNotification('Error', 'Failed to leave room', 'error');
        }
    }

    disconnect() {
        try {
            if (this.ws) {
                this.ws.close(1000, 'Page unload');
                this.ws = null;
            }
            this.isConnected = false;
            console.log('WebSocket disconnected on page unload');
        } catch (error) {
            console.error('Error disconnecting WebSocket:', error);
        }
    }

    showChatRoom() {
        try {
            const connectionForm = document.getElementById('connectionForm');
            const chatRoom = document.getElementById('chatRoom');
            if (connectionForm) connectionForm.classList.add('hidden');
            if (chatRoom) chatRoom.classList.remove('hidden');
            const messageInput = document.getElementById('messageInput');
            if (messageInput) messageInput.focus();
        } catch (error) {
            console.error('Error showing chat:', error);
            this.showNotification('Error', 'Failed to show chat room', 'error');
        }
    }

    scrollToBottom() {
        try {
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } catch (error) {
            console.error('Error scrolling to bottom:', error);
        }
    }

    escapeHtml(text) {
        try {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        } catch (error) {
            console.error('Error escaping HTML:', error);
            return text;
        }
    }

    updateUIState() {
        try {
            const sendBtn = document.getElementById('sendBtn');
            const messageInput = document.getElementById('messageInput');
            if (sendBtn) sendBtn.disabled = !this.isConnected;
            if (messageInput) messageInput.disabled = !this.isConnected;
        } catch (error) {
            console.error('Error updating UI state:', error);
        }
    }

    showNotification(title, message, type = 'info') {
        try {
            if (window.notificationSystem) {
                window.notificationSystem.show(title, message, type);
            } else {
                console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
            }
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    updateOnlineCount(count) {
        try {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) onlineCountElement.textContent = count || 0;
        } catch (error) {
            console.error('Error updating online count:', error);
        }
    }
}

window.ChatWidget = ChatWidget;
