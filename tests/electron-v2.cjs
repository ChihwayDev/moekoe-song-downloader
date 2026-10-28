const { app, BrowserWindow, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../../..'), output = path.join(root, '.verification');
const runDirectory = path.join(output, 'v2-' + Date.now());
const profile = path.join(output, 'profile-v2'), folderA = path.join(runDirectory, 'chosen-A'), folderB = path.join(runDirectory, 'chosen-B');
for (const dir of [profile, folderA, folderB, path.join(output, 'logs'), path.join(output, 'temp')]) fs.mkdirSync(dir, { recursive: true });
app.setName('MoeKoe Downloader V2 Verification');
app.setPath('userData', profile); app.setPath('sessionData', profile); app.setPath('logs', path.join(output, 'logs')); app.setPath('temp', path.join(output, 'temp'));
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('lang', 'en-US');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'source.json'), 'utf8').replace(/^\uFEFF/, ''));
const report = { version: '0.2.0', electron: process.versions.electron, tests: [], apiQualities: [], saved: [] };
let nativeManager, server, player, popup, baseUrl, ending = false;
const watchdog = setTimeout(() => finish(new Error('Verification timed out')), 55000);
const buffers = {};
for (const [q, file] of Object.entries({ current: 'tone.wav', '128': '128.mp3', '320': '320.mp3', flac: 'flac.flac', high: 'high.flac' })) buffers[q] = fs.readFileSync(path.join(output, 'audio-fixtures', file));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function pass(name) { report.tests.push(name); console.log('PASS ' + name); }
async function finish(error) {
  if (ending) return; ending = true; clearTimeout(watchdog);
  if (error) { report.error = error.stack; console.error(error); }
  try { await nativeManager?.stopAll(); } catch (cleanup) { console.error(cleanup); }
  report.success = !error; fs.writeFileSync(path.join(output, 'report-v2.json'), JSON.stringify(report, null, 2));
  server?.closeAllConnections(); server?.close(); app.exit(error ? 1 : 0);
}
async function waitFor(fn, label, timeout = 9000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
const evaluate = (source, win = player) => win.webContents.executeJavaScript(source, true);
const click = (selector, win = player) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`, win);
async function select(selector, value) { await evaluate(`{ const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true})); }`); }
async function setSong(name, url = '/audio/current', hash = 'A') {
  await evaluate('localStorage.setItem("current_song", ' + JSON.stringify(JSON.stringify({ name, author: '测试歌手', hash, url: baseUrl + url, qualityLabel: 'WAV' })) + ')');
}
async function phase(value, win = player) { await waitFor(() => evaluate(`document.querySelector('[data-status]')?.dataset.phase === ${JSON.stringify(value)}`, win), value); }
function checkFile(file, quality) {
  assert.ok(fs.existsSync(file), file); assert.equal(digest(fs.readFileSync(file)), digest(buffers[quality]));
  report.saved.push({ name: path.basename(file), quality, bytes: fs.statSync(file).size });
}
async function waitFile(file, quality) { await waitFor(() => fs.existsSync(file), 'saved ' + path.basename(file)); checkFile(file, quality); }
function hostId(event) { const url = new URL(event.senderFrame.url); assert.equal(url.protocol, 'chrome-extension:'); return url.hostname; }

app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData();
  const hostStyleDir = path.join(source.archive, 'dist', 'assets');
  const hostStyles = fs.readdirSync(hostStyleDir).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(hostStyleDir, name), 'utf8')).join('\n');
  const fixture = '<!doctype html><html><head><meta charset="utf-8"><style>' + hostStyles + '</style><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f5f4f8;color:#2c2438;font:16px "Microsoft YaHei",sans-serif}.fixture{padding:65px 60px}h1{font-size:34px}.player-container{position:fixed;bottom:0;width:100%;padding:20px 24px;background:#fff}.player-bar{display:flex;align-items:center;gap:30px}.song-info{flex:1}.extra-controls{display:flex;align-items:center;gap:12px}.queue-popup{position:fixed;right:20px;bottom:100px;width:300px;height:220px;padding:20px;background:#fff;border-radius:12px;box-shadow:0 5px 20px #0002;color:#333}.queue-popup h3{margin:0 0 15px}.queue-popup p{padding:8px 0}' +
    '</style></head><body><div class="fixture"><p>MoeKoe Music · 新版插件验证</p><h1>歌曲下载 · 自选目录与音质</h1><p>本地生成的真实 WAV / MP3 / FLAC 测试音频</p></div><div class="queue-popup"><h3>播放列表 (3)</h3><p>New Soul</p><p>Here With You</p><p>It Ain’t Me</p></div>' +
    '<div class="player-container"><div class="player-bar"><div>♫</div><div class="song-info">本地验证歌曲</div><div class="controls">◀ &nbsp; ▷ &nbsp; ▶</div><div class="extra-controls"><button>♡</button><button>☰</button></div></div></div></body></html>';
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const apiPaths = ['/user/playlist', '/playlist/track/all', '/privilege/lite', '/song/url'];
    if (apiPaths.includes(url.pathname)) {
      assert.ok((req.headers.authorization || '').includes('token=fixture-token'), 'API request follows the current account');
      res.setHeader('Content-Type', 'application/json'); let value;
      if (url.pathname === '/user/playlist') value = { status: 1, data: { info: [{ global_collection_id: 'collection123', name: '批量测试歌单', count: 3 }] } };
      if (url.pathname === '/playlist/track/all') value = { status: 1, data: { list_info: { name: '批量测试歌单', count: 3 }, songs: ['A', 'B', 'C'].map(hash => ({ hash, name: 'Singer - ' + hash })) } };
      if (url.pathname === '/privilege/lite') {
        const hash = url.searchParams.get('hash');
        value = { status: 1, data: [{ hash: hash + ':128', quality: '128', level: 1, relate_goods: ['320', 'flac', 'high'].map(q => ({ hash: hash + ':' + q, quality: q, level: hash === 'B' && q === '320' ? 0 : 1 })) }] };
      }
      if (url.pathname === '/song/url') {
        const quality = url.searchParams.get('quality'); report.apiQualities.push(quality);
        assert.ok(url.searchParams.get('hash').endsWith(':' + quality));
        value = { status: 1, extName: ['flac', 'high'].includes(quality) ? 'flac' : 'mp3', url: [baseUrl + '/audio/' + quality] };
      }
      res.end(JSON.stringify(value)); return;
    }
    if (url.pathname.startsWith('/audio/')) {
      const quality = url.pathname.split('/').pop(), bytes = buffers[quality === 'slow' ? 'current' : quality];
      if (!bytes) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': quality === 'current' || quality === 'slow' ? 'audio/wav' : quality.includes('flac') || quality === 'high' ? 'audio/flac' : 'audio/mpeg' });
      if (quality === 'slow') { res.write(bytes.subarray(0, 128)); const timer = setTimeout(() => res.end(bytes.subarray(128)), 1600); res.on('close', () => clearTimeout(timer)); }
      else res.end(bytes);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); baseUrl = 'http://127.0.0.1:' + server.address().port;

  const extension = await session.defaultSession.extensions.loadExtension(path.join(root, 'moekoe-song-downloader'), { allowFileAccess: true });
  pass('The v0.2.0 plugin loads in the installed Electron runtime');
  nativeManager = (await import(pathToFileURL(path.join(source.archive, 'electron', 'extensions', 'nativeHostManager.js')).href)).default;
  nativeManager.syncExtensions([extension], [{ name: extension.name, path: path.join(root, 'moekoe-song-downloader'), directory: 'moekoe-song-downloader' }]);
  ipcMain.handle('native-host-get-status', (event, id) => nativeManager.getStatusFromSender(hostId(event), id));
  ipcMain.handle('native-host-send', (event, id, payload) => nativeManager.sendFromSender(hostId(event), id, payload));
  const choices = [folderA, null, folderB];
  ipcMain.handle('show-open-dialog', (event, options) => { hostId(event); assert.ok(options.properties.includes('openDirectory')); const selected = choices.shift(); return { success: !!selected, filePath: selected || undefined }; });
  player = new BrowserWindow({ show: false, width: 1280, height: 940, webPreferences: { preload: path.join(source.archive, 'electron', 'preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, webSecurity: false, backgroundThrottling: false } });
  player.webContents.on('console-message', (event, details) => { if (details.level === 'error') console.error('Renderer: ' + details.message); });
  const fixturePath = path.join(output, 'player-v2.html'); fs.writeFileSync(fixturePath, fixture);
  await player.loadFile(fixturePath);
  await evaluate(`localStorage.setItem('settings',${JSON.stringify(JSON.stringify({ apiBaseUrl: baseUrl }))});localStorage.setItem('MoeData',${JSON.stringify(JSON.stringify({ UserInfo: { token: 'fixture-token', userid: '12345' }, Device: { dfid: 'fixture-device' } }))})`);
  await setSong('初始歌曲');
  await waitFor(() => evaluate('document.querySelectorAll("[data-mkd-trigger]").length===1'), 'button injection'); await click('[data-mkd-trigger]');
  await waitFor(() => evaluate('document.querySelector("[data-native]").dataset.ready==="false"'), 'unauthorized state');
  assert.equal(await evaluate('document.querySelector("[data-start]").disabled'), true);
  pass('Saving is unavailable until the native host has been authorized');
  const authorization = nativeManager.setAuthorization(extension.id, 'song-downloader-saver', true); assert.equal(authorization.success, true);
  await waitFor(() => evaluate('document.querySelector("[data-native]").dataset.ready==="true"'), 'authorized bridge');
  pass('The real installed native-host manager launches the plugin bridge');
  await click('[data-pick-folder]'); await waitFor(() => evaluate(`document.querySelector('[data-folder]').value===${JSON.stringify(folderA)}`), 'selected folder A');
  await click('[data-pick-folder]');
  assert.equal(await evaluate('document.querySelector("[data-folder]").value'), folderA);
  pass('The folder picker records the selected path and cancellation preserves that path');

  const bounds = JSON.parse(await evaluate(`JSON.stringify(document.querySelector('#moekoe-song-downloader').getBoundingClientRect().toJSON())`));
  const queue = JSON.parse(await evaluate(`JSON.stringify(document.querySelector('.queue-popup').getBoundingClientRect().toJSON())`));
  assert.ok(bounds.right <= queue.left || bounds.bottom <= queue.top || bounds.top >= queue.bottom);
  pass('The default panel position does not overlap the playback queue');
  const header = JSON.parse(await evaluate(`JSON.stringify(document.querySelector('[data-drag]').getBoundingClientRect().toJSON())`));
  const startX = Math.round(header.left + 45), startY = Math.round(header.top + 12);
  player.webContents.sendInputEvent({ type: 'mouseDown', x: startX, y: startY, button: 'left', clickCount: 1 });
  player.webContents.sendInputEvent({ type: 'mouseMove', x: startX + 210, y: Math.max(90, startY - 110), movementX: 210, movementY: -110 });
  player.webContents.sendInputEvent({ type: 'mouseUp', x: startX + 210, y: Math.max(90, startY - 110), button: 'left', clickCount: 1 });
  await waitFor(() => evaluate('typeof JSON.parse(localStorage.getItem("moekoe-downloader-settings-v2")).position.x === "number"'), 'drag position persisted');
  const moved = await evaluate('JSON.parse(localStorage.getItem("moekoe-downloader-settings-v2")).position.x');
  const reloaded = new Promise(resolve => player.webContents.once('did-finish-load', resolve));
  player.reload(); await reloaded;
  await waitFor(() => evaluate('!!document.querySelector("[data-mkd-trigger]")'), 'reloaded player'); await click('[data-mkd-trigger]');
  assert.ok(Math.abs(await evaluate('document.querySelector("#moekoe-song-downloader").getBoundingClientRect().left') - moved) < 3);
  assert.equal(await evaluate('document.querySelector("[data-folder]").value'), folderA);
  assert.equal(await evaluate('document.querySelector("[data-position]").value'), 'custom');
  pass('Dragged position and selected directory survive a player reload');

  await waitFor(() => evaluate('!document.querySelector("[data-start]").disabled'), 'start enabled'); await click('[data-start]');
  await waitFile(path.join(folderA, '测试歌手 - 初始歌曲.wav'), 'current'); await phase('completed');
  pass('Single-track download is written directly into the selected directory');
  for (const quality of ['128', '320', 'flac', 'high']) {
    await setSong('音质验证-' + quality); await select('[data-quality-select]', quality); await click('[data-start]');
    const extension = ['flac', 'high'].includes(quality) ? 'flac' : 'mp3';
    await waitFile(path.join(folderA, '测试歌手 - 音质验证-' + quality + '.' + extension), quality); await phase('completed');
  }
  assert.deepEqual(report.apiQualities.slice(0, 4), ['128', '320', 'flac', 'high']);
  pass('Standard, 320 kbps, FLAC, and Hi-Res request and save their actual distinct audio files');
  await click('[data-pick-folder]'); await waitFor(() => evaluate(`document.querySelector('[data-folder]').value===${JSON.stringify(folderB)}`), 'selected folder B');
  await click('[data-mode="playlist"]'); await click('[data-refresh-lists]');
  await waitFor(() => evaluate('document.querySelector("[data-playlist-select]").options.length===2'), 'my playlists');
  await select('[data-playlist-select]', 'collection123'); await click('[data-load-list]');
  await waitFor(() => evaluate('document.querySelectorAll(".mkd-track").length===3'), 'all playlist tracks');
  await select('[data-quality-select]', '320'); await click('[data-start]'); await phase('partial');
  await waitFile(path.join(folderB, '批量测试歌单', 'Singer - A.mp3'), '320');
  await waitFile(path.join(folderB, '批量测试歌单', 'Singer - C.mp3'), '320');
  assert.equal(fs.existsSync(path.join(folderB, '批量测试歌单', 'Singer - B.mp3')), false);
  assert.match(await evaluate('document.querySelector("[data-status]").textContent'), /成功 2 首，失败 1 首/);
  pass('Playlist mode saves all selected available tracks, reports unavailable quality, and continues');
  await click('[data-select-all]'); await click('.mkd-track input');
  assert.equal(await evaluate('document.querySelector("[data-selected-count]").textContent'), '已选 1 首');
  pass('A single song can also be selected from a playlist');

  await evaluate('location.hash="/playlistDetail?global_collection_id=collection123"');
  await waitFor(() => evaluate('!document.querySelector("[data-current-list]").disabled'), 'current route recognized');
  await click('[data-current-list]'); await waitFor(() => evaluate('document.querySelector("[data-selected-count]").textContent==="已选 3 首"'), 'current playlist loaded');
  await select('[data-position]', 'left'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`{const button=document.querySelector('[data-start]').getBoundingClientRect();const panel=document.querySelector('#moekoe-song-downloader').getBoundingClientRect();button.top>=panel.top && button.bottom<=panel.bottom;}`), true);
  fs.writeFileSync(path.join(output, 'downloader-v2-playlist.png'), (await player.webContents.capturePage()).toPNG());
  pass('The currently opened playlist can be read without changing playback');
  pass('The download action remains visible while the playlist body scrolls');
  await click('[data-mode="single"]'); await select('[data-quality-select]', 'current'); await setSong('取消验证', '/audio/slow'); await click('[data-start]');
  await waitFor(() => evaluate('document.querySelector("[data-progress]").textContent.includes("128")'), 'download progress');
  await click('[data-cancel]'); await phase('cancelled');
  assert.equal(fs.existsSync(path.join(folderB, '测试歌手 - 取消验证.wav')), false);
  assert.equal(fs.readdirSync(folderB).some(name => name.endsWith('.part')), false);
  pass('Cancelling clears the in-progress file and stops the active task');
  await setSong('弹窗关闭验证', '/audio/slow');
  popup = new BrowserWindow({ show: false, width: 440, height: 700, webPreferences: { preload: path.join(source.archive, 'electron', 'preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await popup.loadURL('chrome-extension://' + extension.id + '/popup.html');
  await waitFor(() => evaluate('document.querySelector("[data-title]").textContent==="弹窗关闭验证" && !document.querySelector("[data-start]").disabled', popup), 'popup connected');
  await click('[data-start]', popup); await phase('downloading', popup); popup.destroy(); popup = null;
  await waitFile(path.join(folderB, '测试歌手 - 弹窗关闭验证.wav'), 'current'); await phase('completed');
  pass('Closing the plugin settings window does not interrupt a started download');
  await select('[data-position]', 'left'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(output, 'downloader-v2-single.png'), (await player.webContents.capturePage()).toPNG());
  await finish();
}).catch(finish);
