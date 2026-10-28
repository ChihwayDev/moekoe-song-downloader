(function () {
  'use strict';
  const element = document.currentScript;
  const token = element?.dataset.mkdToken;
  if (!token) return;
  const allowed = new Set(['/user/playlist', '/playlist/track/all', '/privilege/lite', '/song/url']);
  function stored(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
  function auth() {
    const state = stored('MoeData'), user = state.UserInfo || {}, device = state.Device || {};
    const fields = { token: user.token, userid: user.userid, t1: user.t1, dfid: device.dfid,
      KUGOU_API_MID: device.mid, KUGOU_API_GUID: device.guid, KUGOU_API_DEV: device.serverDev, KUGOU_API_MAC: device.mac };
    return Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => key + '=' + String(value)).join(';');
  }
  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || request?.channel !== 'mkd-page-request' || request.token !== token) return;
    const reply = { channel: 'mkd-page-response', token, id: request.id };
    try {
      if (!allowed.has(request.path)) throw new Error('不支持的歌曲接口。');
      const headers = { Authorization: auth() };
      let response;
      if (window.kugouapi?.request) {
        const result = await window.kugouapi.request(request.path, { params: request.params, headers });
        response = result?.body;
      } else {
        // Installed 1.7.1 uses the local HTTP API; newer builds expose kugouapi.request.
        const base = stored('settings').apiBaseUrl || 'http://127.0.0.1:6521';
        const url = new URL(String(base).replace(/\/+$/, '') + request.path);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('客户端 API 地址无效。');
        for (const [key, value] of Object.entries(request.params || {})) url.searchParams.set(key, value);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const result = await fetch(url, { headers, signal: controller.signal, credentials: 'include', cache: 'no-store' });
          if (!result.ok) throw new Error('客户端歌曲接口返回 HTTP ' + result.status);
          response = await result.json();
        } finally { clearTimeout(timeout); }
      }
      if (!response || typeof response !== 'object') throw new Error('客户端歌曲接口没有返回有效数据。');
      reply.data = response;
    } catch (error) { reply.error = error?.name === 'AbortError' ? '客户端歌曲接口超时，请重试。' : error.message; }
    window.postMessage(reply, '*');
  });
  window.postMessage({ channel: 'mkd-page-ready', token }, '*');
})();
