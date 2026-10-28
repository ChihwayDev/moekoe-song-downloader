(function (root) {
  'use strict';

  const MAX_BYTES = 512 * 1024 * 1024;
  const MIME_TYPES = {
    mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg',
    wav: 'audio/wav', ape: 'audio/x-ape', wv: 'audio/wavpack'
  };

  function readSong(raw) {
    try {
      const song = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!song || typeof song !== 'object' || Array.isArray(song)) return null;
      if (typeof song.url !== 'string' || !song.url.trim()) return null;
      return {
        name: typeof song.name === 'string' && song.name.trim() ? song.name.trim() : '未命名歌曲',
        author: typeof song.author === 'string' ? song.author.trim() : '',
        hash: typeof song.hash === 'string' ? song.hash : '',
        quality: typeof song.qualityLabel === 'string' ? song.qualityLabel : '',
        url: song.url.trim()
      };
    } catch {
      return null;
    }
  }

  function sourceUrl(song) {
    let url;
    try { url = new URL(song?.url); } catch { throw new Error('请先播放一首歌曲，再开始下载。'); }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('当前是本地文件或临时音源，无需通过此插件下载。');
    }
    if (url.username || url.password) throw new Error('音源地址格式不受支持，请重新播放歌曲。');
    return url.href;
  }

  function cleanPart(value) {
    let part = String(value || '').normalize('NFC')
      .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, '_')
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
    const encoder = new TextEncoder();
    let bounded = '', size = 0;
    for (const char of part) {
      size += encoder.encode(char).length;
      if (size > 100) break;
      bounded += char;
    }
    part = bounded.replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) part = '_' + part;
    return part;
  }

  function fileName(song, extension) {
    if (!Object.hasOwn(MIME_TYPES, extension)) throw new Error('不支持此音频格式。');
    const name = cleanPart(song?.name) || '未命名歌曲';
    const author = cleanPart(song?.author);
    return (author ? author + ' - ' + name : name) + '.' + extension;
  }

  function hasText(bytes, text, offset = 0) {
    return bytes.length >= offset + text.length && Array.from(text).every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  }

  // Read the file signature, rather than renaming a FLAC file to .mp3 or saving an error page.
  function detectFormat(bytes) {
    if (hasText(bytes, 'fLaC')) return 'flac';
    if (hasText(bytes, 'RIFF') && hasText(bytes, 'WAVE', 8)) return 'wav';
    if (hasText(bytes, 'OggS')) {
      const header = String.fromCharCode(...bytes.subarray(0, 128));
      return header.includes('OpusHead') ? 'opus' : 'ogg';
    }
    if (hasText(bytes, 'ftyp', 4)) return 'm4a';
    if (hasText(bytes, 'MAC ')) return 'ape';
    if (hasText(bytes, 'wvpk')) return 'wv';
    if (hasText(bytes, 'ID3')) return 'mp3';
    if (bytes.length >= 4 && bytes[0] === 0xff) {
      if ((bytes[1] & 0xf6) === 0xf0) return 'aac';
      const version = (bytes[1] >> 3) & 3;
      const layer = (bytes[1] >> 1) & 3;
      const bitrate = bytes[2] >> 4;
      const sampleRate = (bytes[2] >> 2) & 3;
      if ((bytes[1] & 0xe0) === 0xe0 && version !== 1 && layer !== 0 &&
          bitrate > 0 && bitrate < 15 && sampleRate !== 3) return 'mp3';
    }
    throw new Error('服务器返回的不是受支持的音频文件。请重新播放歌曲后重试。');
  }

  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
    return (value / 1024 ** index).toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
  }

  async function download(song, options = {}) {
    const url = sourceUrl(song);
    const fetcher = options.fetchImpl || root.fetch.bind(root);
    const controller = new AbortController();
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const timeoutMs = options.timeoutMs ?? 30000;
    let timer, reader, timedOut = false;
    const abort = () => controller.abort();
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    try {
      resetTimeout();
      const response = await fetcher(url, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) {
        const suffix = [401, 403, 404, 410].includes(response.status)
          ? '播放地址可能已过期，请重新播放歌曲后重试。' : '请稍后重试。';
        throw new Error('下载失败（HTTP ' + response.status + '）。' + suffix);
      }
      // A partial response must contain the entire file; silently saving a slice would corrupt it.
      if (response.status === 206) {
        const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!range || Number(range[1]) + 1 !== Number(range[2])) {
          throw new Error('服务器只返回了部分音频，请重新播放歌曲后重试。');
        }
      }
      const lengthHeader = response.headers.get('content-length');
      const encoding = response.headers.get('content-encoding');
      const total = (!encoding || encoding === 'identity') && /^\d+$/.test(lengthHeader || '')
        ? Number(lengthHeader) : 0;
      if (total > maxBytes) throw new Error('文件超过 ' + formatBytes(maxBytes) + '，无法在此版本中下载。');
      if (!response.body?.getReader) throw new Error('当前客户端不支持音频下载，请更新 MoeKoe Music。');
      reader = response.body.getReader();
      let received = 0;
      const chunks = [];
      options.onProgress?.({ received, total });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        resetTimeout();
        received += value.byteLength;
        if (received > maxBytes) throw new Error('文件超过 ' + formatBytes(maxBytes) + '，下载已停止。');
        chunks.push(value);
        options.onProgress?.({ received, total });
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!received) throw new Error('服务器返回了空文件，请重新播放歌曲后重试。');
      if (total && received !== total) throw new Error('音频文件接收不完整，请重试。');
      const data = new Blob(chunks);
      const format = detectFormat(new Uint8Array(await data.slice(0, 256).arrayBuffer()));
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return { blob: new Blob([data], { type: MIME_TYPES[format] }), fileName: fileName(song, format), bytes: received, format };
    } catch (error) {
      if (timedOut) throw new Error('连接长时间没有响应，下载已停止。请检查网络后重试。');
      if (options.signal?.aborted || error?.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
      if (error instanceof TypeError) throw new Error('无法连接音源。请检查网络，或重新播放歌曲后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (reader) {
        try { await reader.cancel(); } catch { /* The stream may already be closed or aborted. */ }
        reader.releaseLock();
      }
      controller.abort();
    }
  }

  const api = Object.freeze({ MAX_BYTES, readSong, sourceUrl, fileName, detectFormat, formatBytes, download });
  root.MoeKoeDownloadCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
