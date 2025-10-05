/**
 * @file worker.js
 * @brief Web Worker для обработки передачи файлов
 * @ingroup filetransfer_module
 * 
 * @details Этот Web Worker отвечает за сборку ArrayBuffer чанков в единый файл
 * без блокировки основного потока UI. Основные функции:
 * - Инициализация метаданных файла
 * - Сборка чанков данных
 * - Финализация и передача готового файла обратно в основной поток
 * 
 * @author Chatters Development Team
 * @version 1.0
 * @date 2025
 */

/**
 * @var {Array<ArrayBuffer>} chunks
 * @brief Массив ArrayBuffer чанков файла
 * @details Хранит части передаваемого файла до сборки
 */
let chunks = [];

/**
 * @var {number} totalBytes
 * @brief Общий размер полученных данных в байтах
 * @details Счетчик для отслеживания прогресса передачи
 */
let totalBytes = 0;

/**
 * @var {Object} meta
 * @brief Метаданные передаваемого файла
 * @details Содержит имя файла, размер и MIME-тип
 * @property {string|null} filename - Имя файла
 * @property {number|null} filesize - Размер файла в байтах
 * @property {string|null} mime - MIME-тип файла
 */
let meta = { filename: null, filesize: null, mime: null };

/**
 * @brief Обработчик сообщений от основного потока
 * 
 * @details Обрабатывает команды:
 * - **init**: Инициализация метаданных файла (имя, размер, MIME-тип)
 * - **chunk**: Добавление чанка данных в массив
 * - **finish**: Сборка всех чанков и отправка готового файла
 * - **reset**: Очистка состояния для новой передачи
 * 
 * @param {MessageEvent} ev - Событие сообщения от основного потока
 * @param {Object} ev.data - Данные сообщения
 * @param {string} ev.data.type - Тип команды
 * 
 * @note Использует Transferable Objects для эффективной передачи ArrayBuffer
 * @see postMessage
 */
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
