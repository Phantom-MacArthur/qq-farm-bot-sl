export {};
export interface WsParserOptions {
    onMessage?: (message: Buffer) => void;
    onClose?: () => void;
    onError?: (error: Error) => void;
    maxPayload?: number;
}
//# sourceMappingURL=ws-parser.d.ts.map