const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'moekoe-song-downloader', 'page-bridge.js'), 'utf8');
function harness() {
  const replies = [], calls = [];
  let listener;
  const window = {
    addEventListener(name, callback) { if (name === 'message') listener = callback; },
    postMessage(value) { replies.push(value); },
    kugouapi: { async request(route, payload) { calls.push({ route, payload }); return { body: { status: 1, data: [] } }; } }
  };
  vm.runInNewContext(source, { window, document: { currentScript: { dataset: { mkdToken: 'fixture-channel' } } },
    localStorage: { getItem(key) { return key === 'MoeData' ? JSON.stringify({ UserInfo: { token: 'fixture-token', userid: '12' } }) : '{}'; } },
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout });
  return { replies, calls, async send(value) { await listener({ source: window, data: { channel: 'mkd-page-request', token: 'fixture-channel', id: 'test', ...value } }); } };
}
test('the built-in API bridge uses the host request contract and current account', async () => {
  const fixture = harness(); await fixture.send({ path: '/song/url', params: { hash: 'abc', quality: 'flac' } });
  assert.equal(fixture.calls[0].route, '/song/url'); assert.equal(fixture.calls[0].payload.params.quality, 'flac');
  assert.match(fixture.calls[0].payload.headers.Authorization, /token=fixture-token/);
  assert.equal(fixture.replies.at(-1).data.status, 1);
});
test('the API bridge cannot be used to invoke unrelated account actions', async () => {
  const fixture = harness(); await fixture.send({ path: '/playlist/del', params: { id: '123' } });
  assert.equal(fixture.calls.length, 0); assert.match(fixture.replies.at(-1).error, /不支持/);
});
test('unrelated page messages do not produce requests or reveal API replies', async () => {
  const fixture = harness(), original = fixture.replies.length;
  await fixture.send({ token: 'wrong-token', path: '/song/url' });
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.replies.length, original);
});
