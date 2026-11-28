export declare function encodeFrame(payload: unknown, maxBytes?: number): Buffer;
export declare class FrameDecoder {
    private buffer;
    private readonly maxBytes;
    private readonly onMessage;
    private readonly onError;
    constructor(onMessage: (msg: any) => void, onError: (error: Error) => void, maxBytes?: number);
    push(chunk: Buffer): void;
    reset(): void;
}
//# sourceMappingURL=framing.d.ts.map