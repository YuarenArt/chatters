// fileTransferManager.js
// FileTransferManager with WebRTC-based file transfer functionality

class FileTransferManager {
    constructor(ws, username, uiHandlers) {
        this.ws = ws;
        this.username = username;
        this.ui = uiHandlers || {};
        this.availableFiles = new Map();
        this.transfers = new Map();
        this.peerConns = new Map();
        this.iceConfig = {
            iceServers: [
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
            ]
        };
        this.chunkSize = 128 * 1024;
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
        this.transfers.set(transferId, { owner: this.username, file, meta, peers: new Map() });
        if (this.ui.addFileMessage) this.ui.addFileMessage(meta, true);
        return transferId;
    }

    requestFile(transferId, owner) {
        const payload = { transferId, owner, from: this.username };
        this.sendSignaling('request-file', payload);
    }

    async handleSignaling(msg) {
        if (!msg || !msg.type) return;
        const type = msg.type;
        const data = msg.data || {};
        try {
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
            }
        } catch (err) {
            console.error('Signaling error:', err);
        }
    }

    handleFileAvailable(data) {
        if (!data || !data.transferId || !data.owner) return;
        if (data.owner === this.username) return;
        this.availableFiles.set(data.transferId, data);
        if (this.ui.addFileMessage) this.ui.addFileMessage(data, false);
    }

    async handleRequestFile(data) {
        if (!data || !data.transferId || !data.owner || !data.from) return;
        if (data.owner !== this.username) return;
        const transfer = this.transfers.get(data.transferId);
        if (!transfer) return;
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
            console.error('Error creating offer:', err);
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
            console.error('Error handling offer:', err);
        }
    }

    async handleAnswer(data) {
        if (!data || !data.sdp || !data.transferId) return;
        if (data.to && data.to !== this.username) return;
        const requester = data.from;
        const transferId = data.transferId;
        const key = transferId + '|' + requester;
        const entry = this.peerConns.get(key);
        if (!entry) return;
        try {
            const desc = { type: data.type || 'answer', sdp: data.sdp };
            await entry.pc.setRemoteDescription(desc);
        } catch (err) {
            console.error('Error setting remote description:', err);
        }
    }

    async handleRemoteIce(data) {
        if (!data || !data.transferId || !data.candidate) return;
        if (data.to && data.to !== this.username) return;
        const peer = data.from || data.peer;
        const key = data.transferId + '|' + peer;
        const entry = this.peerConns.get(key);
        if (!entry) return;
        try {
            await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('Failed to add ICE candidate:', err);
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
            if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
                this.cleanupPeer(transferId, peerUsername);
            }
        };
    }

    setupOwnerDataChannel(dc, transferId, requester, key) {
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 64 * 1024;
        dc.onopen = async () => {
            const entry = this.peerConns.get(key);
            if (!entry || !entry.file) return;
            const file = entry.file;
            const meta = JSON.stringify({ type: 'file-meta', filename: file.name, filesize: file.size, mime: file.type });
            try {
                dc.send(meta);
            } catch (err) {
                console.error('Failed to send metadata:', err);
                this.ui.showNotification?.('Error', 'Failed to start file transfer', 'error');
                this.cleanupPeer(transferId, requester, key);
                return;
            }
            const reader = new FileReader();
            let offset = 0;

            const waitForBuffer = () => new Promise((resolve) => {
                if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
                    resolve();
                } else {
                    dc.onbufferedamountlow = () => resolve();
                }
            });

            while (offset < file.size) {
                const slice = file.slice(offset, offset + this.chunkSize);
                const buf = await new Promise((resolve, reject) => {
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(slice);
                });
                try {
                    await waitForBuffer();
                    dc.send(buf);
                    offset += this.chunkSize;
                    if (this.ui.onTransferProgress) {
                        this.ui.onTransferProgress(transferId, offset / file.size, 'sending', requester);
                    }
                } catch (err) {
                    console.error('Failed to send chunk:', err, 'bufferedAmount:', dc.bufferedAmount);
                    this.ui.showNotification?.('Error', 'File transfer failed: send queue full', 'error');
                    this.cleanupPeer(transferId, requester, key);
                    return;
                }
            }
            try {
                dc.send(JSON.stringify({ type: 'file-end' }));
                if (this.ui.onTransferProgress) {
                    this.ui.onTransferProgress(transferId, 1, 'completed', requester);
                }
            } catch (err) {
                console.error('Failed to send file-end:', err);
                this.ui.showNotification?.('Error', 'Failed to complete file transfer', 'error');
                this.cleanupPeer(transferId, requester, key);
            }
        };
        dc.onclose = () => this.cleanupPeer(transferId, requester, key);
        dc.onerror = (ev) => {
            console.error('DataChannel error (owner):', ev, 'bufferedAmount:', dc.bufferedAmount);
            this.ui.showNotification?.('Error', 'Data channel error during transfer', 'error');
            this.cleanupPeer(transferId, requester, key);
        };
    }

    setupReceiverDataChannel(dc, transferId, owner, key) {
        dc.binaryType = 'arraybuffer';
        let receivedBytes = 0;
        dc.onopen = () => {
            if (this.ui.onTransferProgress) this.ui.onTransferProgress(transferId, 0, 'receiving', owner);
        };
        dc.onmessage = (ev) => {
            const data = ev.data;
            if (typeof data === 'string') {
                try {
                    const obj = JSON.parse(data);
                    if (obj.type === 'file-meta') {
                        const rec = this.peerConns.get(key) || {};
                        rec._meta = obj;
                        this.peerConns.set(key, rec);
                        if (this.transferWorker) {
                            this.transferWorker.postMessage({
                                type: 'init',
                                filename: obj.filename,
                                filesize: obj.filesize,
                                mime: obj.mime
                            });
                        }
                    } else if (obj.type === 'file-end') {
                        if (this.transferWorker) {
                            this.transferWorker.postMessage({ type: 'finish' });
                        }
                        if (this.ui.onTransferProgress) {
                            this.ui.onTransferProgress(transferId, 1, 'completed', owner);
                        }
                    }
                } catch (err) {
                    console.error('Error parsing file metadata:', err);
                }
            } else if (data instanceof ArrayBuffer) {
                receivedBytes += data.byteLength;
                const rec = this.peerConns.get(key) || {};
                const filesize = rec._meta?.filesize || 1;
                const progress = Math.min(receivedBytes / filesize, 1);
                if (this.transferWorker) {
                    this.transferWorker.postMessage({ type: 'chunk', buf: data }, [data]);
                }
                if (this.ui.onTransferProgress) {
                    this.ui.onTransferProgress(transferId, progress, 'receiving', owner, { receivedBytes });
                }
            }
        };
        dc.onclose = () => this.cleanupPeer(transferId, owner, key);
        dc.onerror = (ev) => console.error('DataChannel error (receiver):', ev);
    }

    cleanupPeer(transferId, peer, key) {
        if (key && this.peerConns.has(key)) {
            const pc = this.peerConns.get(key).pc;
            pc.close();
            this.peerConns.delete(key);
            if (this.ui.onTransferProgress) this.ui.onTransferProgress(transferId, 0, 'closed', peer);
        }
    }

    sendSignaling(type, data) {
        try {
            this.ws.send(JSON.stringify({ type, data }));
        } catch (err) {
            console.error('Signaling send error:', err);
        }
    }
}

// Export for both ES modules and traditional script includes
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileTransferManager;
} else {
    window.FileTransferManager = FileTransferManager;
}
