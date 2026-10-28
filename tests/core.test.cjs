const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../moekoe-song-downloader/core.js');

const wav = Buffer.alloc(44 + 8192);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(4096, 0x21)]);
let server, baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/wav') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      res.end(wav);
    } else if (req.url === '/flac.mp3') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(flac);
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      res.write(wav.subarray(0, 128));
      const timer = setTimeout(() => res.end(wav.subarray(128)), 5000);
      res.on('close', () => clearTimeout(timer));
    } else if (req.url === '/empty') res.end();
    else if (req.url === '/html') res.end('<html>Expired URL</html>');
    else if (req.url === '/json') res.end('{"error":"expired"}');
    else if (req.url === '/partial') {
      res.writeHead(206, { 'Content-Range': 'bytes 0-63/' + wav.length }); res.end(wav.subarray(0, 64));
    } else if (req.url === '/whole-partial') {
      res.writeHead(206, { 'Content-Range': 'bytes 0-' + (wav.length - 1) + '/' + wav.length }); res.end(wav);
    } else if (req.url === '/huge') {
      res.writeHead(200, { 'Content-Length': core.MAX_BYTES + 1 }); res.end();
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/wav' }); res.end();
    } else { res.writeHead(403); res.end('expired'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

function song(route = '/wav') { return { name: '测试歌曲', author: '测试歌手', url: baseUrl + route }; }

test('reads the actual MoeKoe current_song shape and tolerates damaged storage', () => {
  const data = core.readSong(JSON.stringify({ name: '  歌曲  ', author: '歌手', hash: '123', url: 'https://audio.example/test', qualityLabel: '无损' }));
  assert.equal(data.name, '歌曲'); assert.equal(data.quality, '无损');
  for (const value of [null, 'null', '[]', 'broken json', '{}', '{"url":42}']) assert.equal(core.readSong(value), null);
});

test('only accepts direct HTTP audio addresses', () => {
  for (const value of ['file:///C:/song.mp3', 'blob:https://example/a', 'javascript:alert(1)', 'data:audio/wav,x', 'https://user:pass@example/song']) {
    assert.throws(() => core.sourceUrl({ url: value }));
  }
  assert.equal(core.sourceUrl({ url: 'https://example.com/music' }), 'https://example.com/music');
});

test('filenames preserve Chinese, remove invalid characters, and avoid reserved Windows names', () => {
  assert.equal(core.fileName({ name: '春日/夜:歌?', author: '歌手*甲' }, 'flac'), '歌手_甲 - 春日_夜_歌_.flac');
  assert.equal(core.fileName({ name: 'CON' }, 'mp3'), '_CON.mp3');
  assert.equal(core.fileName({ name: '...  ', author: '' }, 'wav'), '未命名歌曲.wav');
  const long = core.fileName({ name: '夜🎵'.repeat(150), author: '歌🎶'.repeat(150) }, 'flac');
  assert.ok(Buffer.byteLength(long, 'utf8') < 255);
  assert.ok(long.length < 255); assert.ok(!long.includes('\ufffd'));
  assert.throws(() => core.fileName({ name: 'x' }, '../exe'));
});

test('identifies audio from signatures, including formats with misleading filenames', () => {
  for (const [signature, format] of [
    [Buffer.from('fLaC'), 'flac'], [wav, 'wav'], [Buffer.from('ID3\x04'), 'mp3'],
    [Buffer.from([0xff, 0xfb, 0x90, 0]), 'mp3'], [Buffer.from([0xff, 0xf1, 0x50, 0x80]), 'aac'],
    [Buffer.from('OggSxxxxxxxxOpusHead'), 'opus'], [Buffer.from('OggSxxxxxvorbis'), 'ogg'],
    [Buffer.from('\x00\x00\x00\x20ftypM4A '), 'm4a'], [Buffer.from('MAC '), 'ape'], [Buffer.from('wvpk'), 'wv']
  ]) assert.equal(core.detectFormat(signature), format);
  for (const data of ['', '<html>bad</html>', '{"error":1}', '#EXTM3U']) assert.throws(() => core.detectFormat(Buffer.from(data)));
});

test('downloads a complete real WAV, reports progress, and preserves every byte', async () => {
  const progress = [];
  const result = await core.download(song(), { onProgress: value => progress.push(value) });
  assert.equal(result.fileName, '测试歌手 - 测试歌曲.wav');
  assert.equal(result.blob.type, 'audio/wav'); assert.equal(result.bytes, wav.length);
  assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), wav);
  assert.equal(progress[0].received, 0); assert.equal(progress.at(-1).received, wav.length);
  assert.equal(progress.at(-1).total, wav.length);
});

test('unknown content length and incorrect MIME still produce a correctly named FLAC', async () => {
  const result = await core.download(song('/flac.mp3'));
  assert.equal(result.format, 'flac'); assert.ok(result.fileName.endsWith('.flac'));
  assert.equal(result.blob.type, 'audio/flac');
  assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), flac);
});

test('follows ordinary CDN redirects', async () => {
  const result = await core.download(song('/redirect')); assert.equal(result.bytes, wav.length);
});

test('rejects expiry, HTML/JSON error pages, empty files, and incomplete range responses', async () => {
  for (const [route, expected] of [
    ['/forbidden', /HTTP 403/], ['/html', /不是受支持的音频/], ['/json', /不是受支持的音频/],
    ['/empty', /空文件/], ['/partial', /部分音频/], ['/huge', /超过/]
  ]) await assert.rejects(core.download(song(route)), expected);
  assert.equal((await core.download(song('/whole-partial'))).bytes, wav.length);
});

test('enforces the memory limit even when content length is absent', async () => {
  await assert.rejects(core.download(song('/flac.mp3'), { maxBytes: 100 }), /超过/);
});

test('cancelling in the middle of transfer rejects with AbortError', async () => {
  const controller = new AbortController();
  await assert.rejects(core.download(song('/slow'), {
    signal: controller.signal,
    onProgress(value) { if (value.received > 0) controller.abort(); }
  }), { name: 'AbortError' });
});

test('a task cancelled before it starts does not produce a file', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(core.download(song(), { signal: controller.signal }), { name: 'AbortError' });
});

test('a stalled transfer times out instead of staying busy forever', async () => {
  await assert.rejects(core.download(song('/slow'), { timeoutMs: 80 }), /长时间没有响应/);
});

test('a short response with an incorrect size is not saved', async () => {
  await assert.rejects(core.download(song(), {
    fetchImpl: async () => new Response(wav, { headers: { 'Content-Length': String(wav.length + 1) } })
  }), /不完整/);
});

test('the manifest references real files, and runtime scripts parse without a build step', () => {
  const dir = path.join(__dirname, '..', 'moekoe-song-downloader');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minversion, '1.7.1');
  for (const script of ['core.js', 'content.js', 'data.js', 'view.js', 'page-bridge.js', 'bridge.js', 'popup.js']) {
    new vm.Script(fs.readFileSync(path.join(dir, script), 'utf8'), { filename: script });
  }
  const resources = manifest.content_scripts.flatMap(entry => [...entry.js, ...entry.css]);
  resources.push(manifest.action.default_popup);
  for (const resource of resources) assert.ok(fs.statSync(path.join(dir, resource)).isFile(), resource);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.moekoe_native_hosts[0].platforms.win32.path, 'host/moekoe-song-saver.exe');
});
