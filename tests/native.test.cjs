const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const work = path.join(root, '.verification', 'native-' + Date.now());
fs.mkdirSync(work, { recursive: true });
let child, server, baseUrl;
const pending = new Map();
const audio = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(32768, 23)]);
function command(action, payload = {}, onProgress) {
  const id = crypto.randomUUID();
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native helper timeout: ' + action)); }, 9000);
    pending.set(id, { resolve, reject, timer, onProgress });
    child.stdin.write(JSON.stringify({ type: 'message', payload: { id, action, ...payload } }) + '\n');
  });
  return { id, promise };
}
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/error') { res.writeHead(403); res.end(); return; }
    if (req.url === '/html') { res.end('<html>not audio</html>'); return; }
    if (req.url === '/partial') { res.writeHead(206, { 'Content-Range': 'bytes 0-99/10000' }); res.end(audio.subarray(0, 100)); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
    if (req.url === '/slow') { res.write(audio.subarray(0, 128)); const timer = setTimeout(() => res.end(audio.subarray(128)), 4000); res.on('close', () => clearTimeout(timer)); }
    else res.end(audio);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); baseUrl = 'http://127.0.0.1:' + server.address().port;
  child = spawn(path.join(root, 'moekoe-song-downloader', 'host', 'moekoe-song-saver.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', value => {
    buffer += value; const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const response = JSON.parse(line), entry = pending.get(response.id); if (!entry) continue;
      if (response.kind === 'progress') { entry.onProgress?.(response.data); continue; }
      clearTimeout(entry.timer); pending.delete(response.id); entry.resolve(response);
    }
  });
  child.on('error', error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); });
  assert.equal((await command('ping').promise).kind, 'complete');
});
after(async () => {
  child?.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
  if (child && child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
});
test('streams audio into the user-selected directory with the actual file extension', async () => {
  const result = await command('download', { folder: work, url: baseUrl + '/file.mp3', stem: '歌手 - 自选目录' }).promise;
  assert.equal(result.kind, 'complete'); assert.equal(result.data.format, 'flac');
  assert.equal(path.dirname(result.data.filePath), work);
  assert.deepEqual(fs.readFileSync(result.data.filePath), audio);
});
test('a repeated filename gets a suffix and preserves the original file', async () => {
  const request = { folder: work, url: baseUrl + '/file', stem: '同名歌曲' };
  const first = await command('download', request).promise, second = await command('download', request).promise;
  assert.notEqual(first.data.filePath, second.data.filePath); assert.match(second.data.filePath, /\(1\)\.flac$/);
  assert.deepEqual(fs.readFileSync(first.data.filePath), audio);
});
test('playlist subfolders and sanitized names remain inside the selected directory', async () => {
  const result = await command('download', { folder: work, subfolder: '../../歌单', url: baseUrl + '/file', stem: '../../CON:歌曲' }).promise;
  assert.equal(result.kind, 'complete'); assert.ok(result.data.filePath.startsWith(work + path.sep));
  assert.deepEqual(fs.readFileSync(result.data.filePath), audio);
});
test('cancelling removes partial files before reporting cancellation', async () => {
  let download;
  download = command('download', { folder: work, url: baseUrl + '/slow', stem: '取消测试' }, () => { void command('cancel', { jobId: download.id }).promise; });
  assert.equal((await download.promise).kind, 'cancelled');
  assert.equal(fs.readdirSync(work).some(name => name.endsWith('.part')), false);
  assert.equal(fs.existsSync(path.join(work, '取消测试.flac')), false);
});
test('HTTP errors, partial responses, and HTML are never reported as saved songs', async () => {
  for (const route of ['/error', '/html', '/partial']) {
    const result = await command('download', { folder: work, url: baseUrl + route, stem: '错误测试' }).promise;
    assert.equal(result.kind, 'error');
  }
  assert.equal(fs.readdirSync(work).some(name => name.endsWith('.part')), false);
});
test('a missing destination folder fails without substituting another location', async () => {
  const result = await command('download', { folder: path.join(work, 'does-not-exist'), url: baseUrl + '/file', stem: '测试' }).promise;
  assert.equal(result.kind, 'error'); assert.match(result.data.message, /不存在/);
});
