// worker.js
// Worker: assemble ArrayBuffer chunks into single ArrayBuffer and notify main thread.
// No WebRTC API here.

let chunks = [];
let totalBytes = 0;
let meta = { filename: null, filesize: null, mime: null };

self.onmessage = (ev) => {
    const msg = ev.data;
    switch (msg.type) {
        case 'init':
            // optional: reset and store metadata
            chunks = [];
            totalBytes = 0;
            meta.filename = msg.filename || 'file';
            meta.filesize = msg.filesize || null;
            meta.mime = msg.mime || 'application/octet-stream';
            break;

        case 'chunk':
            // msg.buf is ArrayBuffer (transferred)
            if (msg.buf && msg.buf.byteLength) {
                chunks.push(msg.buf);
                totalBytes += msg.buf.byteLength;
            }
            break;

        case 'finish':
            // assemble into one ArrayBuffer
            try {
                const result = new Uint8Array(totalBytes);
                let offset = 0;
                for (let i = 0; i < chunks.length; i++) {
                    result.set(new Uint8Array(chunks[i]), offset);
                    offset += chunks[i].byteLength;
                }
                // Transfer the underlying buffer back to main thread
                self.postMessage({
                    type: 'file-complete',
                    filename: meta.filename,
                    filesize: totalBytes,
                    mime: meta.mime,
                    buffer: result.buffer
                }, [result.buffer]);
            } catch (err) {
                self.postMessage({ type: 'error', message: err.message || String(err) });
            } finally {
                // cleanup
                chunks = [];
                totalBytes = 0;
                meta = { filename: null, filesize: null, mime: null };
            }
            break;

        case 'reset':
            chunks = [];
            totalBytes = 0;
            meta = { filename: null, filesize: null, mime: null };
            break;

        default:
        // ignore unknown
    }
};
