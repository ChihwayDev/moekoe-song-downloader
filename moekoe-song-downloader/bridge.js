(function () {
  'use strict';
  const HOST = 'song-downloader-saver';
  const pending = new Map();
  const native = window.electronAPI?.nativeHost;
  if (!native) return;
  function fail(entry, message) { clearTimeout(entry.timer); pending.delete(entry.id); entry.respond({ ok: false, error: message }); }
  function reset(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void native.send(HOST, { id: crypto.randomUUID(), action: 'cancel', jobId: entry.id });
      fail(entry, '保存组件长时间没有响应，已请求取消任务。');
    }, 45000);
  }
  native.onMessage(envelope => {
    if (envelope?.hostId !== HOST) return;
    const message = envelope.message;
    const entry = pending.get(message?.id);
    if (!entry) return;
    if (message.kind === 'progress') {
      reset(entry);
      if (Number.isInteger(entry.tabId)) chrome.tabs.sendMessage(entry.tabId, { channel: 'moekoe-song-downloader', event: 'progress', id: entry.id, ...message.data }, () => { void chrome.runtime.lastError; });
      return;
    }
    clearTimeout(entry.timer); pending.delete(entry.id);
    if (message.kind === 'complete') entry.respond({ ok: true, data: message.data });
    else entry.respond({ ok: false, cancelled: message.kind === 'cancelled', error: message.data?.message || '文件保存失败。' });
  });

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.target !== 'mkd-native' || sender.id !== chrome.runtime.id) return;
    (async () => {
      if (request.action === 'status') {
        const result = await native.getStatus(HOST);
        respond({ ok: true, data: { authorized: result?.host?.authorized === true, supported: result?.host?.supported === true, valid: result?.host?.valid === true } });
      } else if (request.action === 'pick-folder') {
        const result = await window.electronAPI.showOpenDialog({ title: '选择歌曲保存文件夹', properties: ['openDirectory', 'createDirectory'], ...(request.folder ? { defaultPath: request.folder } : {}) });
        respond({ ok: true, data: { folder: result.success ? result.filePath : null } });
      } else if (['download', 'cancel'].includes(request.action)) {
        const id = request.id;
        if (typeof id !== 'string' || pending.has(id)) throw new Error('任务编号无效。');
        const entry = { id, tabId: sender.tab?.id, respond };
        pending.set(id, entry); reset(entry);
        const payload = request.action === 'cancel' ? { id, action: 'cancel', jobId: request.jobId } : {
          id, action: 'download', url: request.url, folder: request.folder, stem: request.stem, subfolder: request.subfolder || ''
        };
        const result = await native.send(HOST, payload);
        if (!result?.success) fail(entry, result?.message || '保存组件尚未授权。');
      } else respond({ ok: false, error: '未知操作。' });
    })().catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
