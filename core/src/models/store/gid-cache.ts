export {};
const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const { KNOWN_FRIEND_GIDS_DIR } = require('./shared-state');

function ensureKnownFriendGidsDir(): string {
    if (!fs.existsSync(KNOWN_FRIEND_GIDS_DIR)) {
        fs.mkdirSync(KNOWN_FRIEND_GIDS_DIR, { recursive: true });
    }
    return KNOWN_FRIEND_GIDS_DIR;
}

function getKnownFriendGidsCacheFile(accountId: unknown): string {
    const safeId = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(ensureKnownFriendGidsDir(), `${safeId}.json`);
}

function readKnownFriendGidsCache(accountId: unknown): number[] | null {
    try {
        const file = getKnownFriendGidsCacheFile(accountId);
        if (fs.existsSync(file)) {
            const data = readJsonFile(file);
            if (data && Array.isArray(data.gids)) {
                return data.gids;
            }
        }
    } catch (e) {
        // 忽略读取错误
    }
    return null;
}

function writeKnownFriendGidsCache(accountId: unknown, gids: number[]): void {
    try {
        const file = getKnownFriendGidsCacheFile(accountId);
        writeJsonFileAtomic(file, {
            gids: gids || [],
            updatedAt: Date.now(),
        });
    } catch (e) {
        // 忽略写入错误
    }
}

function readFriendRosterGids(accountId: unknown): string[] | null {
    const file = getKnownFriendGidsCacheFile(accountId).replace(/\.json$/, '.roster.json');
    const data = readJsonFile(file);
    return Array.isArray(data?.gids) ? data.gids : null;
}

function writeFriendRosterGids(accountId: string, gids: string[]): void {
    const file = getKnownFriendGidsCacheFile(accountId).replace(/\.json$/, '.roster.json');
    try { writeJsonFileAtomic(file, { gids }); }
    catch { /* A disk cache failure does not invalidate a successful friend list. */ }
}

function listAllKnownFriendGidsCaches(): Array<{ accountId: string; gids: Array<number | string> }> {
    const caches = new Map<string, Set<number | string>>();
    let entries: import('node:fs').Dirent[];
    try { entries = fs.readdirSync(KNOWN_FRIEND_GIDS_DIR, { withFileTypes: true }); }
    catch { return []; }
    for (const entry of entries) {
        const match = entry.isFile() && /^([\w-]+)(?:\.roster)?\.json$/.exec(entry.name);
        if (!match) continue;
        try {
            const data = readJsonFile(path.join(KNOWN_FRIEND_GIDS_DIR, entry.name));
            if (!Array.isArray(data?.gids)) continue;
            const gids = caches.get(match[1]) ?? new Set<number | string>();
            for (const gid of data.gids) {
                if (typeof gid === 'string' && /^[1-9]\d*$/.test(gid)) gids.add(gid);
                if (typeof gid === 'number' && Number.isSafeInteger(gid) && gid > 0) gids.add(gid);
            }
            caches.set(match[1], gids);
        } catch { /* A malformed cache must not hide the other accounts. */ }
    }
    return [...caches].map(([accountId, gids]) => ({ accountId, gids: [...gids] }));
}

module.exports = {
    ensureKnownFriendGidsDir,
    getKnownFriendGidsCacheFile,
    readKnownFriendGidsCache,
    writeKnownFriendGidsCache,
    readFriendRosterGids,
    writeFriendRosterGids,
    listAllKnownFriendGidsCaches,
};
