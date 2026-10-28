(function (root) {
  'use strict';
  const LABELS = { '128': '标准 128 kbps', '320': '高品 320 kbps', flac: '无损 FLAC', high: 'Hi-Res' };
  const LEVELS = ['high', 'flac', '320', '128'];
  function check(signal) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); }
  function text(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }

  function normalizeTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const hash = text(raw.hash || raw.FileHash || raw.filehash || raw.audio_info?.hash);
    if (!hash || hash.startsWith('local_') || raw.isLocal) return null;
    let name = text(raw.audio_name || raw.songname || raw.song_name || raw.SongName || raw.base?.audio_name || raw.name);
    let author = text(raw.author || raw.author_name || raw.singername || raw.singer_name || raw.base?.author_name);
    if (!author && !raw.audio_name && !raw.songname && name.includes(' - ')) {
      const split = name.indexOf(' - '); author = name.slice(0, split); name = name.slice(split + 3);
    }
    return {
      hash, name: name || '未命名歌曲', author, url: text(raw.url),
      quality: text(raw.qualityLabel || raw.quality), resolvedQuality: text(raw.resolvedQuality),
      qualityOptions: Array.isArray(raw.qualityOptions) ? raw.qualityOptions : []
    };
  }

  function parsePlaylistId(input) {
    const value = text(input);
    if (/^[\w-]{3,180}$/.test(value)) return value;
    try {
      const url = new URL(value);
      const query = new URLSearchParams(url.search);
      const hashQuery = new URLSearchParams((url.hash.split('?')[1] || '').split('#')[0]);
      const id = query.get('global_collection_id') || hashQuery.get('global_collection_id') || query.get('id') || hashQuery.get('id');
      if (id && /^[\w-]{3,180}$/.test(id)) return id;
    } catch {}
    throw new Error('请打开一个歌单，或输入歌单 ID / 含 global_collection_id 的歌单链接。');
  }

  function ensureResponse(response, context) {
    if (!response || Number(response.status) !== 1) {
      const error = new Error(context + '失败：' + (response?.error_msg || response?.msg || response?.error || '请确认已经登录，且当前账户可以访问此内容。'));
      error.needsAction = Number(response?.status) === 2;
      throw error;
    }
    return response;
  }

  async function listPlaylists(request, signal) {
    const lists = [], seen = new Set();
    for (let page = 1; page <= 100; page++) {
      check(signal);
      const response = ensureResponse(await request('/user/playlist', { page, pagesize: 500, t: Date.now() }), '读取我的歌单');
      check(signal);
      const rows = response.data?.info || response.data?.lists || [];
      if (!Array.isArray(rows)) throw new Error('客户端返回了无法识别的歌单列表。');
      let added = 0;
      for (const row of rows) {
        const id = text(row.global_collection_id || row.global_collectionid || row.collection_id);
        if (id && !seen.has(id) && !row.authors) {
          seen.add(id); added++;
          lists.push({ id, name: text(row.name || row.listname) || '未命名歌单', count: Number(row.count || row.song_count || 0) });
        }
      }
      if (rows.length < 500) return lists;
      if (!added) throw new Error('歌单列表分页没有前进，请从当前打开的歌单读取。');
    }
    throw new Error('歌单列表超过本版本读取上限，请从当前打开的歌单读取。');
  }

  async function loadPlaylist(request, input, options = {}) {
    const id = parsePlaylistId(input);
    const tracks = [], seen = new Set();
    let title = '歌单 ' + id;
    for (let page = 1; page <= 200; page++) {
      check(options.signal);
      const response = ensureResponse(await request('/playlist/track/all', { id, page, pagesize: 300 }), '读取歌单');
      check(options.signal);
      const data = response.data || {};
      const rows = data.songs || data.info || [];
      if (!Array.isArray(rows)) throw new Error('客户端返回了无法识别的歌曲列表。');
      title = text(data.list_info?.name || data.list_info?.listname || data.listinfo?.name) || title;
      let added = 0;
      for (const row of rows) {
        const track = normalizeTrack(row);
        if (track && !seen.has(track.hash)) { seen.add(track.hash); tracks.push(track); added++; }
      }
      options.onProgress?.(tracks.length);
      if (rows.length < 300) return { id, title, tracks };
      // Do not return an incomplete playlist if a server ignores page=.
      if (!added) throw new Error('歌单分页重复返回相同歌曲，未开始下载。请刷新歌单后重试。');
    }
    throw new Error('歌单超过 60,000 首，请拆分歌单后下载。');
  }

  function variants(response) {
    const map = new Map();
    for (const item of response?.data || []) {
      for (const value of [item, ...(item?.relate_goods || [])]) {
        const quality = text(value?.quality);
        if (value?.hash && value.level !== 0 && Object.hasOwn(LABELS, quality)) map.set(quality, text(value.hash));
      }
    }
    return map;
  }

  async function resolveSong(request, song, quality, signal) {
    check(signal);
    if (quality === 'current') {
      root.MoeKoeDownloadCore.sourceUrl(song);
      return { ...song, actualQuality: song.quality || '当前播放音质' };
    }
    if (!song?.hash) throw new Error('当前歌曲缺少歌曲标识，请重新播放或从歌单中选择。');
    if (quality !== 'best' && !Object.hasOwn(LABELS, quality)) throw new Error('未知的下载音质。');
    const privilege = ensureResponse(await request('/privilege/lite', { hash: song.hash }), '读取可用音质');
    check(signal);
    const choices = variants(privilege);
    const selected = quality === 'best' ? LEVELS.find(level => choices.has(level)) : quality;
    if (!selected || !choices.has(selected)) throw new Error('该歌曲没有可用的' + (LABELS[quality] || '音质') + '。');
    const response = ensureResponse(await request('/song/url', { hash: choices.get(selected), quality: selected, ppage_id: '356753938' }), '获取音频地址');
    check(signal);
    const url = Array.isArray(response.url) ? response.url[0] : response.url;
    if (!url || response.extName === 'mp4') throw new Error('所选音质未返回可下载的音频地址。');
    const resolved = { ...song, url, resolvedQuality: selected, actualQuality: LABELS[selected] };
    root.MoeKoeDownloadCore.sourceUrl(resolved);
    return resolved;
  }

  const api = Object.freeze({ LABELS, normalizeTrack, parsePlaylistId, listPlaylists, loadPlaylist, resolveSong, variants });
  root.MoeKoeDownloaderData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
