const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function isolatedDataDir(t) {
    const root = fs.realpathSync(os.tmpdir());
    const dir = fs.mkdtempSync(path.join(root, 'farm-config-recovery-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(dir)), root);
        fs.rmSync(dir, { recursive: true });
    });
    return dir;
}

test('saving a new login credential restores missing configuration from the running store', (t) => {
    const dir = isolatedDataDir(t);
    const previousDataDir = process.env.FARM_DATA_DIR;
    process.env.FARM_DATA_DIR = dir;
    t.after(() => {
        if (previousDataDir === undefined) delete process.env.FARM_DATA_DIR;
        else process.env.FARM_DATA_DIR = previousDataDir;
    });
    const store = require('../dist/models/store');
    const file = path.join(dir, 'store.json');
    const configs = path.join(dir, 'account-configs');
    const marker = path.join(configs, '.format.json');
    const account = store.addOrUpdateAccount({ name: 'First', platform: 'wx', code: 'old-code' }).accounts.at(-1);
    const other = store.addOrUpdateAccount({ name: 'Second', platform: 'wx', code: 'other-code' }).accounts.at(-1);
    store.applyConfigSnapshot({ plantingStrategy: 'max_exp', preferredSeedId: 42 }, { accountId: account.id });
    store.applyConfigSnapshot({ plantingStrategy: 'bag_priority', bagSeedPriority: [43, 44] }, { accountId: other.id });
    store.setUITheme('dark');

    const paths = [file, marker, path.join(configs, `${account.id}.json`), path.join(configs, `${other.id}.json`)];
    const expected = paths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const file of paths) fs.unlinkSync(file);

    store.addOrUpdateAccount({ id: account.id, code: 'new-code' });

    assert.deepEqual(paths.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))), expected);
    assert.equal(store.getAccounts().accounts.find(row => row.id === account.id).code, 'new-code');
});

test('config recovery preserves existing files and a fresh process requires a valid format marker', (t) => {
    const { createConfigStorage } = require('../dist/models/store/config-storage');
    const dir = isolatedDataDir(t);
    const file = path.join(dir, 'store.json');
    const accountFile = path.join(dir, 'account-configs', '1.json');
    const marker = path.join(dir, 'account-configs', '.format.json');
    const storage = createConfigStorage(file);
    storage.load();
    storage.saveAccount('1', { strategy: 'preferred' });
    fs.writeFileSync(accountFile, 'invalid json', 'utf8');
    fs.unlinkSync(marker);

    assert.throws(() => createConfigStorage(file).load(), { code: 'STORAGE_READ_FAILED' });
    storage.restoreMissingFiles('1');

    assert.equal(fs.readFileSync(accountFile, 'utf8'), 'invalid json');
    assert.throws(() => createConfigStorage(file).load(), { code: 'STORAGE_READ_FAILED' });
});
