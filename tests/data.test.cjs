const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../moekoe-song-downloader/core.js');
const data = require('../moekoe-song-downloader/data.js');
const privilege = { status: 1, data: [{ hash: 'base128', quality: '128', level: 1, relate_goods: [
  { hash: 'hq320', quality: '320', level: 1 }, { hash: 'lossless', quality: 'flac', level: 1 }, { hash: 'hires', quality: 'high', level: 0 }
] }] };

test('normalizes playlist, album, and current-track names without losing remix text', () => {
  assert.deepEqual(data.normalizeTrack({ hash: 'a', name: 'Artist - Song - Remix' }).name, 'Song - Remix');
  assert.equal(data.normalizeTrack({ hash: 'a', name: 'Song - Remix', author: 'Artist' }).name, 'Song - Remix');
  assert.equal(data.normalizeTrack({ audio_info: { hash: 'a' }, base: { audio_name: 'Song', author_name: 'Artist' } }).author, 'Artist');
  assert.equal(data.normalizeTrack({ hash: 'local_123', name: 'local' }), null);
});
test('reads a playlist ID from raw IDs, URLs, and hash-router links', () => {
  for (const value of ['123456', 'https://music.moekoe.cn/#/playlistDetail?global_collection_id=123456', 'https://example.com/?global_collection_id=123456']) assert.equal(data.parsePlaylistId(value), '123456');
  assert.throws(() => data.parsePlaylistId('invalid text with spaces'));
});
test('loads all pages beyond the first 300 tracks and removes duplicate hashes', async () => {
  const pages = [];
  const result = await data.loadPlaylist(async (route, params) => {
    pages.push(params.page);
    const start = (params.page - 1) * 300, count = params.page === 1 ? 300 : 7;
    return { status: 1, data: { list_info: { name: '测试歌单' }, songs: Array.from({ length: count }, (_, index) => ({ hash: 'hash' + (start + index), name: '歌手 - 歌曲' + (start + index) })) } };
  }, '123456');
  assert.equal(result.tracks.length, 307); assert.equal(result.title, '测试歌单'); assert.deepEqual(pages, [1, 2]);
});
test('a server ignoring pagination fails instead of silently returning an incomplete playlist', async () => {
  await assert.rejects(data.loadPlaylist(async () => ({ status: 1, data: { info: Array.from({ length: 300 }, (_, index) => ({ hash: 'h' + index, name: 'song' })) } }), '123456'), /分页重复/);
});
test('cancelled playlist reads cannot return a partial batch', async () => {
  const controller = new AbortController();
  await assert.rejects(data.loadPlaylist(async () => { controller.abort(); return { status: 1, data: { songs: [] } }; }, '123456', { signal: controller.signal }), { name: 'AbortError' });
});
test('explicit quality requests use the corresponding privilege hash', async () => {
  const calls = [];
  const result = await data.resolveSong(async (route, params) => {
    calls.push({ route, params });
    return route === '/privilege/lite' ? privilege : { status: 1, url: ['https://audio.example/song.flac'], extName: 'flac' };
  }, { hash: 'original', name: '歌' }, 'flac');
  assert.equal(calls[1].params.hash, 'lossless'); assert.equal(calls[1].params.quality, 'flac');
  assert.equal(result.actualQuality, '无损 FLAC');
});
test('unavailable explicit quality never silently falls back to another quality', async () => {
  let urlCalls = 0;
  await assert.rejects(data.resolveSong(async route => { if (route === '/song/url') urlCalls++; return privilege; }, { hash: 'x' }, 'high'), /没有可用的Hi-Res/);
  assert.equal(urlCalls, 0);
});
test('best available quality skips inaccessible Hi-Res', async () => {
  const result = await data.resolveSong(async route => route === '/privilege/lite' ? privilege : { status: 1, url: ['https://audio.example/file'] }, { hash: 'x' }, 'best');
  assert.equal(result.resolvedQuality, 'flac');
});
test('current playback quality reuses the current source without changing playback', async () => {
  const result = await data.resolveSong(() => { throw new Error('should not call API'); }, { hash: 'x', name: '歌', url: 'https://audio.example/current', quality: 'FLAC' }, 'current');
  assert.equal(result.url, 'https://audio.example/current');
});
test('account errors and video streams cannot become a falsely successful download', async () => {
  await assert.rejects(data.resolveSong(async () => ({ status: 2, error_msg: '需要验证' }), { hash: 'x' }, 'flac'), /需要验证/);
  await assert.rejects(data.resolveSong(async route => route === '/privilege/lite' ? privilege : { status: 1, url: ['https://audio.example/video'], extName: 'mp4' }, { hash: 'x' }, '320'), /未返回可下载/);
});
