// hostStorageManager.js
// English comments in code per user requirement.

/**
 * HostStorageManager
 * - Creates per-room IndexedDB databases named chat_room_${slug}
 * - Object store: 'messages' { keyPath: 'id', autoIncrement: true }
 * - Message record: { id?, ts, username, text, type, meta }
 *
 * Usage:
 * await HostStorageManager.initHostDB(slug, {room_id, host_token});
 * await HostStorageManager.saveMessage(slug, messageObject);
 * const msgs = await HostStorageManager.getMessages(slug, {limit:100, sinceTs:...});
 */

class HostStorageManager {
    static dbPrefix = 'chat_room_';
    static dbCache = new Map(); // slug -> IDBDatabase

    static _dbName(slug) {
        const dbName = `${HostStorageManager.dbPrefix}${slug}`;
        console.log(`[HostStorageManager] Database name generated: ${dbName}`);
        return dbName;
    }

    static async _openDB(slug) {
        console.log(`[HostStorageManager] Opening database for slug: ${slug}`);
        if (HostStorageManager.dbCache.has(slug)) {
            const cached = HostStorageManager.dbCache.get(slug);
            // If db is closed, reopen
            try {
                if (cached && typeof cached.name === 'string') {
                    console.log(`[HostStorageManager] Using cached database connection for slug: ${slug}`);
                    return cached;
                }
            } catch (e) { 
                console.warn(`[HostStorageManager] Error accessing cached database for ${slug}:`, e);
                // fallthrough to reopen 
            }
        }
        const name = HostStorageManager._dbName(slug);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = (ev) => {
                const db = ev.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const os = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    os.createIndex('ts', 'ts', { unique: false });
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'k' });
                }
            };
            req.onsuccess = (ev) => {
                const db = ev.target.result;
                console.log(`[HostStorageManager] Successfully opened database: ${db.name}, version: ${db.version}`);
                HostStorageManager.dbCache.set(slug, db);
                
                // Add error handler to the database
                db.onerror = (event) => {
                    console.error(`[HostStorageManager] Database error (${db.name}):`, event.target.error);
                };
                
                resolve(db);
            };
            req.onerror = (ev) => {
                console.error(`[HostStorageManager] Failed to open database '${name}':`, ev.target.error);
                reject(ev.target.error);
            };
            
            req.onblocked = () => {
                console.warn(`[HostStorageManager] Database '${name}' open blocked`);
                reject(new Error('Database open blocked'));
            };
        });
    }

    static async initHostDB(slug, {room_id, host_token} = {}) {
        console.log(`[HostStorageManager] Initializing database for room: ${slug}, room_id: ${room_id}, host_token: ${host_token}`);
        const db = await HostStorageManager._openDB(slug);
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(['meta'], 'readwrite');
                const st = tx.objectStore('meta');
                const meta = {
                    room_id,
                    host_token,
                    created_at: new Date().toISOString()
                };
                st.put({ k: 'info', v: meta });
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    static async saveMessage(slug, msg) {
        console.log(`[HostStorageManager] Saving message to database for slug: ${slug}`, msg);
        const db = await HostStorageManager._openDB(slug);
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(['messages'], 'readwrite');
                const st = tx.objectStore('messages');
                const request = st.add({
                    ts: msg.ts || Date.now(),
                    username: msg.username || 'anonymous',
                    text: msg.text || '',
                    type: msg.type || 'message',
                    meta: msg.meta || {}
                });
                
                request.onsuccess = () => {
                    console.log(`[HostStorageManager] Message saved successfully`);
                    resolve(request.result);
                };
                
                request.onerror = (e) => {
                    console.error('[HostStorageManager] Error saving message:', e.target.error);
                    reject(e.target.error);
                };
            } catch (e) {
                console.error('[HostStorageManager] Exception in saveMessage:', e);
                reject(e);
            }
        });
    }

    static async getMessages(slug, {limit=100, sinceTs=0, reverse=true} = {}) {
        console.log(`[HostStorageManager] Fetching messages for slug: ${slug}, limit: ${limit}, sinceTs: ${sinceTs}`);
        const db = await HostStorageManager._openDB(slug);
        limit = typeof limit === 'number' ? limit : 200;
        sinceTs = sinceTs || 0;
        reverse = reverse !== undefined ? reverse : true;

        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(['messages'], 'readonly');
                const st = tx.objectStore('messages');
                const index = st.index('ts');
                const range = IDBKeyRange.lowerBound(sinceTs);
                const messages = [];
                let count = 0;

                const request = reverse ? 
                    index.openCursor(range, 'prev') : 
                    index.openCursor(range, 'next');

                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor && count < limit) {
                        messages.push(cursor.value);
                        count++;
                        cursor.continue();
                    } else {
                        console.log(`[HostStorageManager] Retrieved ${messages.length} messages`);
                        resolve(messages);
                    }
                };

                request.onerror = (e) => {
                    console.error('[HostStorageManager] Error fetching messages:', e.target.error);
                    reject(e.target.error);
                };
            } catch (e) {
                console.error('[HostStorageManager] Exception in getMessages:', e);
                reject(e);
            }
        });
    }

    static async clearRoom(slug) {
        console.log(`[HostStorageManager] Clearing database for room: ${slug}`);
        if (!slug) {
            console.warn('[HostStorageManager] Attempted to clear room with empty slug');
            return Promise.resolve(false);
        }
        
        // Close and remove from cache if exists
        if (HostStorageManager.dbCache.has(slug)) {
            try { 
                const db = HostStorageManager.dbCache.get(slug);
                if (db) db.close(); 
            } catch (e) {
                console.warn(`[HostStorageManager] Error closing database connection:`, e);
            }
            HostStorageManager.dbCache.delete(slug);
        }
        
        const dbName = HostStorageManager._dbName(slug);
        console.log(`[HostStorageManager] Deleting database: ${dbName}`);
        
        return new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(dbName);
            
            req.onsuccess = () => {
                console.log(`[HostStorageManager] Successfully deleted database: ${dbName}`);
                resolve(true);
            };
            
            req.onerror = (e) => {
                console.error(`[HostStorageManager] Error deleting database ${dbName}:`, e.target.error);
                reject(e.target.error);
            };
            
            req.onblocked = () => {
                const err = new Error(`Database ${dbName} deletion blocked (likely due to open connections)`);
                console.error('[HostStorageManager]', err.message);
                reject(err);
            };
        });
    }

    static async getMeta(slug, key, defVal) {
        console.log(`[HostStorageManager] Getting meta for slug: ${slug}, key: ${key}`);
        const db = await HostStorageManager._openDB(slug);
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(['meta'], 'readonly');
                const st = tx.objectStore('meta');
                const req = st.get(key);
                req.onsuccess = () => {
                    const result = req.result ? req.result.v : defVal;
                    console.log(`[HostStorageManager] Retrieved meta for ${key}:`, result);
                    resolve(result);
                };
                req.onerror = (e) => {
                    console.error(`[HostStorageManager] Error getting meta for ${key}:`, e.target.error);
                    reject(e.target.error);
                };
            } catch (e) {
                console.error(`[HostStorageManager] Exception getting meta for ${key}:`, e);
                reject(e);
            }
        });
    }

    static async cleanupOldDbs(maxAgeDays = 180) {
        try {
            const map = RoomMappingManager.list();
            const now = Date.now();
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

            for (const [slug, meta] of Object.entries(map)) {
                const createdAt = new Date(meta.created_at).getTime();
                if (now - createdAt > maxAgeMs) {
                    await HostStorageManager.deleteDB(slug);
                    RoomMappingManager.remove(slug);
                    console.log(`Cleaned up old database for slug: ${slug}`);
                }
            }
        } catch (e) {
            console.error('Cleanup old DBs error:', e);
        }
    }
}

window.HostStorageManager = HostStorageManager;
