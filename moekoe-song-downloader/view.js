(function (root) {
  'use strict';
  const core = root.MoeKoeDownloadCore;
  const markup = '<header data-drag><span>歌曲下载 <small>0.2.0</small></span><div class="mkd-header-actions"><select data-position aria-label="面板位置"><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option><option value="custom" disabled>自定义</option></select><button type="button" data-close aria-label="关闭下载面板">×</button></div></header><div class="mkd-body">' +
    '<div class="mkd-tabs"><button type="button" data-mode="single">单曲下载</button><button type="button" data-mode="playlist">歌单下载</button></div>' +
    '<div class="mkd-single"><div class="mkd-song"><span class="mkd-note" aria-hidden="true">♫</span><div><strong data-title></strong><p data-author></p></div></div></div>' +
    '<div class="mkd-playlist" hidden><div class="mkd-row"><select data-playlist-select aria-label="选择歌单"><option value="">选择我的歌单</option></select><button type="button" data-refresh-lists>刷新</button></div>' +
    '<div class="mkd-row"><input data-list-input aria-label="歌单 ID 或链接" placeholder="歌单 ID 或含 global_collection_id 的链接"><button type="button" data-load-list>读取</button></div>' +
    '<button class="mkd-text-button" type="button" data-current-list>读取当前页面歌单</button><p class="mkd-hint" data-list-title>读取后默认选择全部歌曲，也可以只勾选一首。</p>' +
    '<div class="mkd-selection" hidden><label><input type="checkbox" data-select-all> 全选</label><span data-selected-count></span></div><div class="mkd-tracks" data-tracks></div>' +
    '<div class="mkd-pages" hidden><button type="button" data-prev-page>上一页</button><span data-page-label></span><button type="button" data-next-page>下一页</button></div>' +
    '<label class="mkd-check"><input type="checkbox" data-subfolder> 以歌单名创建子文件夹</label></div>' +
    '<div class="mkd-field"><label for="mkd-quality-select">下载音质</label><select id="mkd-quality-select" data-quality-select><option value="current">当前播放音质</option><option value="128">标准 128 kbps</option><option value="320">高品 320 kbps</option><option value="flac">无损 FLAC</option><option value="high">Hi-Res</option><option value="best">最高可用音质</option></select></div>' +
    '<div class="mkd-field"><label for="mkd-folder-path">保存到</label><div class="mkd-row"><input id="mkd-folder-path" data-folder readonly placeholder="请选择保存文件夹"><button type="button" data-pick-folder>选择…</button></div></div>' +
    '<p class="mkd-native" data-native></p><progress hidden aria-label="当前歌曲下载进度"></progress><p class="mkd-progress" data-progress></p>' +
    '<p class="mkd-status" data-status role="status" aria-live="polite"></p></div><div class="mkd-actions"><button type="button" data-start>下载当前歌曲</button><button type="button" data-cancel hidden>取消</button></div>';
  function create(element, transport, options = {}) {
    element.innerHTML = markup;
    let state, page = 0, updating = false, disposed = false, listSignature = '', trackSignature = '';
    const query = selector => element.querySelector(selector);
    const action = async (name, payload = {}) => {
      try { const result = await transport(name, { ...payload, page }); if (result) render(result); }
      catch (error) { query('[data-status]').textContent = error.message; query('[data-status]').dataset.phase = 'error'; }
    };
    function render(next) {
      if (disposed) return;
      state = next;
      const busy = next.busy, playlist = next.mode === 'playlist';
      query('.mkd-single').hidden = playlist; query('.mkd-playlist').hidden = !playlist;
      element.querySelectorAll('[data-mode]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.mode === next.mode)); button.disabled = busy; });
      const display = next.activeSong || next.song;
      query('[data-title]').textContent = display?.name || '请先播放一首在线歌曲';
      query('[data-author]').textContent = display?.author || '';
      query('[data-folder]').value = next.folder || ''; query('[data-folder]').title = next.folder || '';
      query('[data-quality-select]').value = next.quality;
      query('[data-position]').value = next.positionPreset || 'left';
      query('[data-quality-select] option[value="current"]').disabled = playlist;
      query('[data-quality-select]').disabled = busy;
      query('[data-subfolder]').checked = next.subfolder; query('[data-subfolder]').disabled = busy;
      query('[data-pick-folder]').disabled = busy || !next.nativeReady;
      for (const selector of ['[data-refresh-lists]', '[data-load-list]', '[data-playlist-select]', '[data-list-input]']) query(selector).disabled = busy || next.listing;
      query('[data-current-list]').disabled = busy || next.listing || !next.currentPlaylistId;
      query('[data-native]').textContent = next.nativeReady ? '保存组件已就绪 · 完成文件写入后显示成功' : '请在「设置 → 插件」授权本插件的 song-downloader-saver，然后刷新插件。';
      query('[data-native]').dataset.ready = String(next.nativeReady);
      const start = query('[data-start]');
      start.disabled = busy || next.listing || !next.nativeReady || !next.folder || !(playlist ? next.selectedCount : next.song);
      start.textContent = busy ? '正在下载…' : playlist ? '下载所选 ' + next.selectedCount + ' 首' : '下载当前歌曲';
      query('[data-cancel]').hidden = !busy && !next.listing;
      const progress = query('progress'); progress.hidden = !busy;
      if (next.total) { progress.max = next.total; progress.value = next.received; } else progress.removeAttribute('value');
      query('[data-progress]').textContent = busy ? (next.jobTotal > 1 ? '第 ' + Math.min(next.finished + 1, next.jobTotal) + ' / ' + next.jobTotal + ' 首 · ' : '') + core.formatBytes(next.received) + (next.total ? ' / ' + core.formatBytes(next.total) : '') : '';
      query('[data-status]').textContent = next.message || (next.folder ? '选择音质后开始下载。指定音质不可用时会显示失败原因。' : '先选择保存文件夹。面板标题栏可拖动，位置会自动记住。');
      query('[data-status]').dataset.phase = next.phase;
      query('[data-list-title]').textContent = next.playlistTitle ? next.playlistTitle + ' · 共 ' + next.trackCount + ' 首' : '读取后默认选择全部歌曲，也可以只勾选一首。';
      const listsKey = JSON.stringify(next.playlists);
      if (listsKey !== listSignature) {
        listSignature = listsKey;
        const select = query('[data-playlist-select]'), previous = select.value;
        select.replaceChildren(new Option('选择我的歌单', ''));
        next.playlists.forEach(list => select.add(new Option(list.name + (list.count ? ' (' + list.count + ')' : ''), list.id)));
        select.value = previous;
      }
      query('.mkd-selection').hidden = !next.trackCount;
      const all = query('[data-select-all]');
      all.checked = next.trackCount > 0 && next.selectedCount === next.trackCount;
      all.indeterminate = next.selectedCount > 0 && next.selectedCount < next.trackCount;
      all.disabled = busy || next.listing; query('[data-selected-count]').textContent = '已选 ' + next.selectedCount + ' 首';
      const key = JSON.stringify([next.tracks, busy, next.listing]);
      if (key !== trackSignature) {
        trackSignature = key;
        const fragment = document.createDocumentFragment();
        next.tracks.forEach(track => {
          const row = document.createElement('label'); row.className = 'mkd-track';
          const check = document.createElement('input'); check.type = 'checkbox'; check.checked = track.selected; check.disabled = busy || next.listing;
          check.addEventListener('change', () => action('selectTrack', { hash: track.hash, selected: check.checked }));
          const text = document.createElement('span'); text.className = 'mkd-track-text';
          const name = document.createElement('span'); name.textContent = track.name; text.append(name);
          const detail = document.createElement('small'); detail.textContent = track.result || track.author; detail.title = track.result || track.author;
          detail.dataset.result = track.result?.startsWith('失败') ? 'error' : '';
          text.append(detail); row.append(check, text); fragment.append(row);
        }); query('[data-tracks]').replaceChildren(fragment);
      }
      query('.mkd-pages').hidden = next.trackCount <= 100;
      query('[data-page-label]').textContent = (page + 1) + ' / ' + Math.max(1, Math.ceil(next.trackCount / 100));
      query('[data-prev-page]').disabled = page === 0; query('[data-next-page]').disabled = (page + 1) * 100 >= next.trackCount;
      options.onRender?.(next);
    }
    element.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { page = 0; action('options', { mode: button.dataset.mode }); }));
    query('[data-close]').addEventListener('click', () => options.onClose?.());
    query('[data-position]').addEventListener('change', event => action('position', { preset: event.target.value }));
    query('[data-quality-select]').addEventListener('change', event => action('options', { quality: event.target.value }));
    query('[data-subfolder]').addEventListener('change', event => action('options', { subfolder: event.target.checked }));
    query('[data-pick-folder]').addEventListener('click', () => action('chooseFolder'));
    query('[data-refresh-lists]').addEventListener('click', () => action('refreshPlaylists'));
    query('[data-load-list]').addEventListener('click', () => { page = 0; action('loadPlaylist', { input: query('[data-list-input]').value || query('[data-playlist-select]').value }); });
    query('[data-playlist-select]').addEventListener('change', event => { query('[data-list-input]').value = event.target.value; });
    query('[data-current-list]').addEventListener('click', () => { page = 0; action('loadPlaylist', { input: state?.currentPlaylistId }); });
    query('[data-select-all]').addEventListener('change', event => action('selectAll', { selected: event.target.checked }));
    query('[data-start]').addEventListener('click', () => action('start')); query('[data-cancel]').addEventListener('click', () => action('cancel'));
    query('[data-prev-page]').addEventListener('click', () => { page = Math.max(0, page - 1); refresh(); });
    query('[data-next-page]').addEventListener('click', () => { page++; refresh(); });
    if (!options.floating) { query('[data-position]').hidden = true; query('[data-close]').hidden = true; query('[data-drag]').removeAttribute('data-drag'); }
    async function refresh() { if (updating || disposed) return; updating = true; try { await action('state'); } finally { updating = false; } }
    void refresh(); const timer = setInterval(refresh, 800);
    return { refresh, destroy() { disposed = true; clearInterval(timer); } };
  }
  root.MoeKoeDownloaderView = Object.freeze({ create });
})(globalThis);
