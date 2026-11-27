import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { yishuDate } from '../config/yishuhuanfu';

const { getDataFile } = require('../config/runtime-paths');

export interface YishuHistoryEntry {
    at: number;
    day: string;
    type: 'round' | 'sale' | 'order' | 'resolved' | 'settlement' | 'plant' | 'harvest';
    slot?: number;
    status?: string;
    orderId?: string;
    [key: string]: unknown;
}

function historyFile(accountId: string): string {
    return getDataFile(path.join('yishuhuanfu', `${Buffer.from(accountId, 'utf8').toString('base64url')}.jsonl`));
}

export function readYishuHistory(accountId: string): YishuHistoryEntry[] {
    if (!accountId) return [];
    let source: string;
    try {
        source = fs.readFileSync(historyFile(accountId), 'utf8');
    } catch (error: any) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    return source.split('\n').flatMap(line => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as YishuHistoryEntry]; }
        catch { return []; }
    });
}

export function appendYishuHistory(accountId: string, seconds: number, entry: Omit<YishuHistoryEntry, 'day' | 'at'>): void {
    if (!accountId) return;
    const file = historyFile(accountId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ ...entry, day: yishuDate(seconds), at: seconds })}\n`, 'utf8');
}

export function pendingYishuOrder(history: YishuHistoryEntry[]): YishuHistoryEntry | undefined {
    const terminal = new Set(history.filter(entry => entry.type === 'sale' || entry.type === 'resolved').map(entry => entry.orderId));
    return history.filter(entry => entry.type === 'order' && !terminal.has(entry.orderId)).at(-1);
}

export function beginYishuOrder(accountId: string, seconds: number, order: Record<string, unknown>): string {
    const orderId = randomUUID();
    appendYishuHistory(accountId, seconds, { ...order, type: 'order', orderId });
    return orderId;
}
