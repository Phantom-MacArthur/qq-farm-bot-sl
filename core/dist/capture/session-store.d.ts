import type { CapturePlatform } from './types';
export {};
interface PublicInfo {
    host: string;
    addresses: string[];
    mitmPort: number;
    mitmProxyAutoStopSec: number;
    certUrl: string;
}
export interface CaptureSession {
    id: string;
    platform: CapturePlatform;
    createdAt: number;
    updatedAt: number;
    cancelled: boolean;
    completed: boolean;
    code: string;
    openId: string;
    clientVersion?: string;
    friendGids: Set<number>;
    friendSource: string;
    friendListComplete: boolean;
    proxy: any;
    publicInfo: PublicInfo;
    bypassHosts: string[];
}
//# sourceMappingURL=session-store.d.ts.map