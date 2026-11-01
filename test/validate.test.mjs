import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_USER_AGENT, runPool, validateSource } from '../src/validate.mjs';
import { MASTER, MEDIA, text, withServer } from './helpers.mjs';

test('validateSource: maestro → variante de medios con segmentos', () =>
  withServer({ '/live/master.m3u8': text(MASTER), '/live/media.m3u8': text(MEDIA) }, async (server) => {
    const result = await validateSource({ url: `${server.base}/live/master.m3u8` });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'master');
    assert.deepEqual(server.hits.map((hit) => hit.path), ['/live/master.m3u8', '/live/media.m3u8']);
    assert.equal(server.hits[0].headers['user-agent'], DEFAULT_USER_AGENT);
  }));

test('validateSource: un playlist de medios directo vale', () =>
  withServer({ '/a.m3u8': text(MEDIA) }, async (server) => {
    assert.equal((await validateSource({ url: `${server.base}/a.m3u8` })).ok, true);
  }));

test('validateSource: motivos de fallo por etapa', () => {
  const ts = Buffer.alloc(376);
  ts[0] = 0x47;
  ts[188] = 0x47;
  const routes = {
    '/html.m3u8': text('<html>no</html>', 'text/html'),
    '/ts': (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(ts);
    },
    '/empty.m3u8': text('#EXTM3U\n#EXT-X-VERSION:3\n'),
    '/master-broken.m3u8': text('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmissing.m3u8\n'),
    '/forbidden.m3u8': text('no', 'text/plain', 403),
  };
  return withServer(routes, async (server) => {
    const check = (path) => validateSource({ url: `${server.base}${path}` });
    assert.deepEqual(await check('/nope.m3u8').then(({ stage, reason }) => ({ stage, reason })), { stage: 'manifest', reason: 'http_404' });
    assert.equal((await check('/forbidden.m3u8')).reason, 'http_403');
    assert.equal((await check('/html.m3u8')).reason, 'not_playlist');
    assert.equal((await check('/ts')).reason, 'not_hls');
    assert.equal((await check('/empty.m3u8')).reason, 'empty_playlist');
    assert.deepEqual(await check('/master-broken.m3u8').then(({ stage, reason }) => ({ stage, reason })), { stage: 'variant', reason: 'http_404' });
  });
});

test('validateSource: manda el Referer y el User-Agent de la fuente también a la variante', () => {
  const guarded = (body) => (req, res) => {
    const ok = req.headers.referer === 'https://site.example/' && req.headers['user-agent'] === 'CrKey/1.44';
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(ok ? body : 'no');
  };
  return withServer({ '/m.m3u8': guarded(MASTER), '/media.m3u8': guarded(MEDIA) }, async (server) => {
    assert.equal((await validateSource({ url: `${server.base}/m.m3u8` })).reason, 'http_403');
    assert.equal((await validateSource({ url: `${server.base}/m.m3u8`, referrer: 'https://site.example/', userAgent: 'CrKey/1.44' })).ok, true);
  });
});

test('validateSource: sigue redirecciones y respeta el tiempo máximo', () => {
  const routes = {
    '/go': (_req, res) => {
      res.writeHead(302, { Location: '/final.m3u8' });
      res.end();
    },
    '/final.m3u8': text(MEDIA),
    '/loop': (_req, res) => {
      res.writeHead(302, { Location: '/loop' });
      res.end();
    },
    '/slow.m3u8': () => {
      // nunca responde
    },
  };
  return withServer(routes, async (server) => {
    assert.equal((await validateSource({ url: `${server.base}/go` })).ok, true);
    assert.equal((await validateSource({ url: `${server.base}/loop` })).reason, 'too_many_redirects');
    const slow = await validateSource({ url: `${server.base}/slow.m3u8` }, { timeoutMs: 200 });
    assert.equal(slow.reason, 'timeout');
    assert.ok(slow.ms < 2000);
  });
});

test('validateSource: un servidor que no escucha es «refused» y una URL rara no lanza', async () => {
  assert.equal((await validateSource({ url: 'http://127.0.0.1:1/a.m3u8' }, { timeoutMs: 2000 })).reason, 'refused');
  assert.equal((await validateSource({ url: 'rtmp://x/y' })).reason, 'bad_scheme');
});

test('runPool respeta el máximo global y el de cada host, y conserva el orden', async () => {
  const items = [...Array.from({ length: 8 }, (_, i) => ({ host: 'a', i })), ...Array.from({ length: 4 }, (_, i) => ({ host: 'b', i: 8 + i })), { host: 'c', i: 12 }];
  let active = 0;
  let maxActive = 0;
  const perHost = new Map();
  let maxPerHost = 0;
  const results = await runPool(
    items,
    async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      perHost.set(item.host, (perHost.get(item.host) ?? 0) + 1);
      maxPerHost = Math.max(maxPerHost, perHost.get(item.host));
      await sleep(10);
      perHost.set(item.host, perHost.get(item.host) - 1);
      active--;
      if (item.i === 3) throw new Error('falla');
      return item.i;
    },
    { concurrency: 3, perHost: 2, hostGapMs: 1, getHost: (item) => item.host },
  );
  assert.ok(maxActive <= 3);
  assert.ok(maxPerHost <= 2);
  assert.deepEqual(results.map((result, index) => (index === 3 ? result.reason : result)), [0, 1, 2, 'internal', 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});
