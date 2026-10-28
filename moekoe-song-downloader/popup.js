(function () {
  'use strict';
  const CHANNEL = 'moekoe-song-downloader'; let tabId = null;
  const query = () => new Promise((resolve, reject) => chrome.tabs.query({}, tabs => { const error = chrome.runtime.lastError; if (error) reject(new Error(error.message)); else resolve(tabs); }));
  const send = (id, action, payload) => new Promise((resolve, reject) => chrome.tabs.sendMessage(id, { channel: CHANNEL, action, payload }, response => {
    const error = chrome.runtime.lastError;
    if (error || response?.plugin !== CHANNEL) reject(new Error('未连接播放器。首次更新后请完全退出并重启 MoeKoe Music。'));
    else if (response.error) reject(new Error(response.error)); else resolve(response);
  }));
  async function transport(action, payload) {
    if (tabId !== null) { try { return await send(tabId, action, payload); } catch (error) { if (action !== 'state') throw error; tabId = null; } }
    const responses = await Promise.allSettled((await query()).filter(tab => Number.isInteger(tab.id)).map(async tab => ({ id: tab.id, state: await send(tab.id, 'state', payload) })));
    const matches = responses.filter(result => result.status === 'fulfilled').map(result => result.value);
    const found = matches.find(result => result.state.busy) || matches.find(result => result.state.song) || matches[0];
    if (!found) throw new Error('未连接播放器。更新后请完全退出并重启 MoeKoe Music。');
    tabId = found.id; return action === 'state' ? found.state : send(tabId, action, payload);
  }
  const view = globalThis.MoeKoeDownloaderView.create(document.getElementById('moekoe-song-downloader'), transport);
  window.addEventListener('pagehide', () => view.destroy(), { once: true });
})();
