export {};
declare const QQ_MINIAPP_APP_ID = "1112386029";
declare global {
    var _qqLoginTask: {
        id: string;
        owner: string;
        status: QqLoginTaskStatus;
        qrImage: string;
        expiresAt: number;
        user?: any;
        result?: {
            code: string;
            uin: string;
            nickname: string;
        };
        cleanupPromise?: Promise<void>;
    } | undefined;
}
export type QqLoginTaskStatus = 'waiting_scan' | 'scanned' | 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'cleaning' | 'cleanup_failed';
export interface QqLoginTask {
    taskId: string;
    status: QqLoginTaskStatus;
    qrImage: string;
    expiresAt: number;
}
declare function createLoginTask(): Promise<QqLoginTask>;
declare function queryLoginStatus(taskId: string): Promise<QqLoginTask>;
declare function getMiniappCode(taskId: string): Promise<{
    code: string;
    nickname: string;
    uin: string;
}>;
declare function requestNapCatSessionCode(uin: string): Promise<{
    ok: boolean;
    code?: string;
    error?: string;
    needsRescan?: boolean;
}>;
declare function cancelLoginTask(taskId: string): Promise<void>;
export { cancelLoginTask, createLoginTask, getMiniappCode, QQ_MINIAPP_APP_ID, queryLoginStatus, requestNapCatSessionCode, };
//# sourceMappingURL=service.d.ts.map