(function () {
  'use strict';
  if (window.top !== window || globalThis.__moekoeSongDownloader) return;
  globalThis.__moekoeSongDownloader = true;
  const core = globalThis.MoeKoeDownloadCore, data = globalThis.MoeKoeDownloaderData;
  const CHANNEL = 'moekoe-song-downloader', SETTINGS = 'moekoe-downloader-settings-v2';
  let settings;
  try { settings = JSON.parse(localStorage.getItem(SETTINGS) || '{}'); } catch { settings = {}; }
  settings = { mode: 'single', singleQuality: 'current', playlistQuality: 'flac', folder: '', subfolder: true, position: { preset: 'left' }, ...settings };
  const task = { phase: 'idle', message: '', received: 0, total: 0, finished: 0, jobTotal: 0, activeSong: null };
  let panel, view, open = false, returnFocus, controller = null, currentJob = '', nativeReady = false, checkingNative = false;
  let playlists = [], playlist = { title: '', tracks: [] }, selected = new Set(), results = new Map(), listing = false, listingController = null;
  let rpcResolve;
  const rpcReady = new Promise(resolve => { rpcResolve = resolve; });
  const token = crypto.randomUUID(), pending = new Map();
  const abortError = () => new DOMException('Aborted', 'AbortError');
  function persist() { try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch {} }
  function currentSong() {
    try {
      const raw = JSON.parse(localStorage.getItem('current_song') || 'null'), song = core.readSong(raw);
      core.sourceUrl(song);
      return song ? { ...song, resolvedQuality: raw.resolvedQuality || '', qualityOptions: raw.qualityOptions || [] } : null;
    } catch { return null; }
  }
  function currentPlaylistId() { try { return new URLSearchParams(location.hash.split('?')[1] || location.search).get('global_collection_id') || ''; } catch { return ''; } }
  function busy() { return !!controller; }
  function getState(page = 0) {
    const tracks = playlist.tracks.slice(Math.max(0, page) * 100, (Math.max(0, page) + 1) * 100).map(song => ({ hash: song.hash, name: song.name, author: song.author, selected: selected.has(song.hash), result: results.get(song.hash) || '' }));
    const song = currentSong();
    return { plugin: CHANNEL, ...task, busy: busy(), listing, mode: settings.mode, folder: settings.folder, nativeReady,
      quality: settings.mode === 'single' ? settings.singleQuality : settings.playlistQuality,
      subfolder: settings.subfolder, positionPreset: settings.position?.preset || 'custom', song: song ? { name: song.name, author: song.author } : null,
      playlists, playlistTitle: playlist.title, currentPlaylistId: currentPlaylistId(), tracks,
      trackCount: playlist.tracks.length, selectedCount: selected.size };
  }
  function nativeRequest(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ target: 'mkd-native', action, ...payload }, response => {
        const error = chrome.runtime.lastError;
        if (error || !response) { nativeReady = false; reject(new Error('请在插件管理页授权 song-downloader-saver，然后刷新插件或重启 MoeKoe Music。')); }
        else if (!response.ok) reject(response.cancelled ? abortError() : new Error(response.error || '保存组件操作失败。'));
        else resolve(response.data);
      });
    });
  }
  async function checkNative() {
    if (checkingNative) return;
    checkingNative = true;
    try { const status = await nativeRequest('status'); nativeReady = status.authorized && status.supported && status.valid; }
    catch { nativeReady = false; } finally { checkingNative = false; }
  }
  window.addEventListener('message', event => {
    const value = event.data;
    if (event.source !== window || value?.token !== token) return;
    if (value.channel === 'mkd-page-ready') { rpcResolve(); return; }
    if (value.channel !== 'mkd-page-response') return;
    const entry = pending.get(value.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(value.id);
    if (value.error) entry.reject(new Error(value.error)); else entry.resolve(value.data);
  });
  const script = document.createElement('script'); script.src = chrome.runtime.getURL('page-bridge.js'); script.dataset.mkdToken = token;
  script.addEventListener('load', () => script.remove()); (document.head || document.documentElement).append(script);
  async function request(path, params) {
    let readyTimer;
    try { await Promise.race([rpcReady, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('歌曲接口尚未连接，请重启客户端。')), 5000); })]); }
    finally { clearTimeout(readyTimer); }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('歌曲接口超时，请重试。')); }, 25000);
      pending.set(id, { resolve, reject, timer }); window.postMessage({ channel: 'mkd-page-request', token, id, path, params }, '*');
    });
  }
  async function chooseFolder() {
    const result = await nativeRequest('pick-folder', { folder: settings.folder });
    if (result.folder) { settings.folder = result.folder; persist(); task.message = '保存文件夹已更新：' + result.folder; }
  }
  async function refreshPlaylists() {
    if (listing || busy()) return;
    listing = true; listingController = new AbortController(); task.message = '正在读取我的歌单…';
    try { playlists = await data.listPlaylists(request, listingController.signal); task.message = playlists.length ? '已读取 ' + playlists.length + ' 个歌单，请选择后点击「读取」。' : '没有找到歌单。也可以打开歌单页面后读取。'; }
    catch (error) { task.message = error.name === 'AbortError' ? '已取消读取歌单。' : error.message; task.phase = 'error'; }
    finally { listing = false; listingController = null; }
  }
  async function loadPlaylist(input) {
    if (listing || busy()) return;
    listing = true; listingController = new AbortController(); task.phase = 'idle'; task.message = '正在读取歌单全部歌曲…';
    try {
      const loaded = await data.loadPlaylist(request, input, { signal: listingController.signal, onProgress(count) { task.message = '正在读取歌单，已获取 ' + count + ' 首…'; } });
      playlist = loaded; selected = new Set(loaded.tracks.map(song => song.hash)); results = new Map(); settings.mode = 'playlist'; persist();
      task.message = loaded.tracks.length ? '已读取 ' + loaded.tracks.length + ' 首，可勾选后开始下载。' : '这个歌单没有可下载的歌曲。';
    } catch (error) { task.phase = 'error'; task.message = error.name === 'AbortError' ? '已取消读取歌单。' : error.message; }
    finally { listing = false; listingController = null; }
  }
  async function startDownload() {
    if (busy() || listing) return;
    const songs = settings.mode === 'single' ? [currentSong()].filter(Boolean) : playlist.tracks.filter(song => selected.has(song.hash)).map(song => ({ ...song }));
    if (!songs.length) { task.message = '请先选择歌曲。'; return; }
    if (!settings.folder) { task.message = '请先选择保存文件夹。'; return; }
    const quality = settings.mode === 'single' ? settings.singleQuality : settings.playlistQuality;
    const folder = settings.folder, subfolder = settings.mode === 'playlist' && settings.subfolder ? playlist.title : '';
    controller = new AbortController(); const signal = controller.signal;
    task.phase = 'downloading'; task.message = '正在检查保存组件…'; task.received = task.total = task.finished = 0; task.jobTotal = songs.length;
    let saved = 0, failed = 0;
    try {
      await checkNative(); if (!nativeReady) throw new Error('请先在插件管理页授权本地保存组件。');
      for (const song of songs) {
        if (signal.aborted) throw abortError();
        task.activeSong = { name: song.name, author: song.author }; task.received = task.total = 0; task.message = '正在获取「' + song.name + '」的音频地址…';
        try {
          const resolved = await data.resolveSong(request, song, quality, signal); if (signal.aborted) throw abortError();
          task.message = '正在下载「' + song.name + '」 · ' + resolved.actualQuality;
          currentJob = crypto.randomUUID();
          const output = await nativeRequest('download', { id: currentJob, url: resolved.url, folder, subfolder, stem: core.fileName(song, 'mp3').slice(0, -4) });
          currentJob = ''; saved++; results.set(song.hash, '已保存 · ' + resolved.actualQuality); task.message = '已保存：' + output.filePath;
        } catch (error) {
          if (signal.aborted || error.name === 'AbortError') throw abortError();
          failed++; results.set(song.hash, '失败：' + error.message); task.message = error.message;
          if (songs.length === 1 || error.needsAction || /风控|验证码|需要验证|登录失效/.test(error.message)) throw error;
        }
        task.finished++;
      }
      task.phase = failed ? 'partial' : 'completed';
      task.message = songs.length === 1 && saved ? task.message : '下载结束：成功 ' + saved + ' 首，失败 ' + failed + ' 首。' + (failed ? '失败原因显示在歌曲列表中。' : '保存位置：' + folder);
    } catch (error) {
      task.phase = signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'error';
      task.message = task.phase === 'cancelled' ? '已取消。已保存 ' + saved + ' 首；未完成文件已清理。' : error.message;
    } finally { controller = null; currentJob = ''; task.activeSong = null; }
  }
  async function handle(action, payload = {}) {
    if (action === 'state') return getState(payload.page);
    if (action === 'cancel') {
      controller?.abort(); listingController?.abort(); task.message = '正在取消…';
      if (currentJob) void nativeRequest('cancel', { id: crypto.randomUUID(), jobId: currentJob }).catch(() => {});
    } else if (action === 'position') {
      if (['left', 'center', 'right'].includes(payload.preset)) { settings.position = { preset: payload.preset }; persist(); placePanel(); }
    } else if (!busy() && !listing) {
      if (action === 'chooseFolder') await chooseFolder();
      else if (action === 'options') {
        if (['single', 'playlist'].includes(payload.mode)) settings.mode = payload.mode;
        const allowed = ['128', '320', 'flac', 'high', 'best', ...(settings.mode === 'single' ? ['current'] : [])];
        if (allowed.includes(payload.quality)) settings[settings.mode === 'single' ? 'singleQuality' : 'playlistQuality'] = payload.quality;
        if (typeof payload.subfolder === 'boolean') settings.subfolder = payload.subfolder;
        persist(); task.message = ''; task.phase = 'idle';
      } else if (action === 'refreshPlaylists') void refreshPlaylists();
      else if (action === 'loadPlaylist') void loadPlaylist(payload.input);
      else if (action === 'selectAll') selected = new Set(payload.selected ? playlist.tracks.map(song => song.hash) : []);
      else if (action === 'selectTrack') { if (playlist.tracks.some(song => song.hash === payload.hash)) { if (payload.selected) selected.add(payload.hash); else selected.delete(payload.hash); } }
      else if (action === 'start') void startDownload();
    }
    return getState(payload.page);
  }
  function placePanel() {
    if (!panel) return;
    const pos = settings.position || { preset: 'left' }, width = panel.offsetWidth || 420, height = panel.offsetHeight || 450;
    const safeTop = 70, maxY = Math.max(safeTop, window.innerHeight - 100 - height);
    const x = typeof pos.x === 'number' ? pos.x : pos.preset === 'right' ? window.innerWidth - width - 24 : pos.preset === 'center' ? (window.innerWidth - width) / 2 : 24;
    const y = typeof pos.y === 'number' ? pos.y : maxY;
    panel.style.left = Math.max(12, Math.min(x, window.innerWidth - width - 12)) + 'px'; panel.style.top = Math.max(safeTop, Math.min(y, maxY)) + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  }
  function showPanel(show, trigger) {
    open = show; if (!panel) return; if (trigger) returnFocus = trigger; panel.hidden = !show;
    if (show) { placePanel(); view.refresh(); panel.querySelector('[data-close]').focus(); } else if (returnFocus?.isConnected) returnFocus.focus();
    document.querySelectorAll('[data-mkd-trigger]').forEach(button => button.setAttribute('aria-expanded', String(show)));
  }
  function installDrag() {
    const header = panel.querySelector('[data-drag]'); let drag = null;
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,select')) return;
      const rect = panel.getBoundingClientRect(); drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }; header.setPointerCapture(event.pointerId); event.preventDefault();
    });
    header.addEventListener('pointermove', event => { if (!drag || event.pointerId !== drag.id) return; settings.position = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y }; placePanel(); });
    const end = event => { if (!drag || event.pointerId !== drag.id) return; drag = null; persist(); }; header.addEventListener('pointerup', end); header.addEventListener('pointercancel', end);
  }
  function ensureUI() {
    const mounts = document.querySelectorAll('.player-container .extra-controls, .lyrics-bg .player-controls'); if (!mounts.length) return;
    if (!panel?.isConnected) {
      view?.destroy(); panel = document.createElement('section'); panel.id = 'moekoe-song-downloader'; panel.hidden = !open;
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '歌曲下载'); document.body.append(panel);
      view = globalThis.MoeKoeDownloaderView.create(panel, handle, { floating: true, onClose: () => showPanel(false), onRender() { if (open) placePanel(); } }); installDrag();
    }
    mounts.forEach(mount => {
      if (mount.querySelector('[data-mkd-trigger]')) return;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mkdTrigger = ''; button.title = '歌曲下载'; button.setAttribute('aria-label', '歌曲下载'); button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', String(open));
      button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg>';
      button.addEventListener('click', event => { event.stopPropagation(); showPanel(!open, button); }); mount.prepend(button);
    });
  }
  let scheduled = false;
  const observer = new MutationObserver(() => { if (scheduled) return; scheduled = true; setTimeout(() => { scheduled = false; ensureUI(); }, 200); }); observer.observe(document.body, { childList: true, subtree: true });
  const mountTimer = setInterval(ensureUI, 1500), statusTimer = setInterval(checkNative, 5000);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) { event.preventDefault(); showPanel(false); } }); window.addEventListener('resize', placePanel);
  window.addEventListener('pagehide', () => {
    controller?.abort(); listingController?.abort(); if (currentJob) void nativeRequest('cancel', { id: crypto.randomUUID(), jobId: currentJob }).catch(() => {});
    observer.disconnect(); clearInterval(mountTimer); clearInterval(statusTimer); view?.destroy();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(abortError()); } pending.clear();
  }, { once: true });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== CHANNEL || sender.id !== chrome.runtime.id) return;
    if (message.event === 'progress' && message.id === currentJob) { task.received = message.received; task.total = message.total; return; }
    if (!document.querySelector('.player-container .extra-controls') || !message.action) return;
    handle(message.action, message.payload || {}).then(respond, error => respond({ plugin: CHANNEL, error: error.message })); return true;
  });
  ensureUI(); void checkNative();
})();
