import type { CaptureConfig } from './types';
export {};
export interface ParsedHttpHead {
    method: string;
    target: string;
    version: string;
    headers: Record<string, string>;
    headerEnd: number;
    isUpgrade: boolean;
}
export interface ExtractLoginInfoInput {
    host?: string;
    head?: Buffer | string;
    parsedHead?: ParsedHttpHead | null;
    body?: Buffer | string;
    config?: Partial<CaptureConfig>;
}
export interface ExtractedLoginInfo {
    code: string;
    openId: string;
    matched: boolean;
    clientVersion?: string;
}
//# sourceMappingURL=code-extractor.d.ts.map