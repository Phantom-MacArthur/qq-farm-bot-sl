"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameDecoder = void 0;
exports.encodeFrame = encodeFrame;
const constants_1 = require("./constants");
function encodeFrame(payload, maxBytes = constants_1.MAX_IPC_FRAME_BYTES) {
    const json = JSON.stringify(payload);
    if (json === undefined) {
        throw Object.assign(new Error('IPC payload is not JSON-serializable'), { code: 'IPC_INVALID_PAYLOAD' });
    }
    const body = Buffer.from(json, 'utf8');
    if (body.length > maxBytes) {
        throw Object.assign(new Error(`IPC frame exceeds max size (${body.length} > ${maxBytes})`), { code: 'IPC_FRAME_TOO_LARGE', size: body.length, maxBytes });
    }
    const frame = Buffer.allocUnsafe(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    return frame;
}
class FrameDecoder {
    buffer = Buffer.alloc(0);
    maxBytes;
    onMessage;
    onError;
    constructor(onMessage, onError, maxBytes = constants_1.MAX_IPC_FRAME_BYTES) {
        this.onMessage = onMessage;
        this.onError = onError;
        this.maxBytes = maxBytes;
    }
    push(chunk) {
        if (!chunk || chunk.length === 0)
            return;
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (length === 0 || length > this.maxBytes) {
                this.buffer = Buffer.alloc(0);
                this.onError(Object.assign(new Error(`Invalid IPC frame length: ${length} (max=${this.maxBytes})`), { code: 'IPC_FRAME_TOO_LARGE', size: length, maxBytes: this.maxBytes }));
                return;
            }
            if (this.buffer.length < 4 + length)
                return;
            const payloadBytes = this.buffer.subarray(4, 4 + length);
            this.buffer = this.buffer.subarray(4 + length);
            let parsed;
            try {
                parsed = JSON.parse(payloadBytes.toString('utf8'));
            }
            catch (error) {
                this.onError(Object.assign(new Error(`Invalid IPC JSON frame: ${error?.message || error}`), { code: 'IPC_MALFORMED_JSON' }));
                return;
            }
            this.onMessage(parsed);
        }
    }
    reset() {
        this.buffer = Buffer.alloc(0);
    }
}
exports.FrameDecoder = FrameDecoder;
//# sourceMappingURL=framing.js.map