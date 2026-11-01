import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanReferrer, cleanUserAgent, isUsableUrl, qualityRank } from '../src/clean.mjs';
import { looksLikeTs, parsePlaylist } from '../src/hls.mjs';

test('cleanUserAgent quita el prefijo #EXTVLCOPT (aunque se repita) y descarta lo inutilizable', () => {
  assert.equal(cleanUserAgent('#EXTVLCOPT:http-user-agent=Mozilla/5.0 CrKey/1.44'), 'Mozilla/5.0 CrKey/1.44');
  assert.equal(cleanUserAgent('#EXTVLCOPT:http-user-agent=#EXTVLCOPT:http-user-agent=VLC/3.0'), 'VLC/3.0');
  assert.equal(cleanUserAgent('  "Kodi/19"  '), 'Kodi/19');
  assert.equal(cleanUserAgent(null), null);
  assert.equal(cleanUserAgent('   '), null);
  assert.equal(cleanUserAgent('a\r\nb'), null);
  assert.equal(cleanUserAgent('x'.repeat(513)), null);
});

test('cleanReferrer solo admite URL http(s) y no las normaliza', () => {
  assert.equal(cleanReferrer('https://www.example.com'), 'https://www.example.com');
  assert.equal(cleanReferrer('#EXTVLCOPT:http-referrer=https://a.example/'), 'https://a.example/');
  assert.equal(cleanReferrer('No response'), null);
  assert.equal(cleanReferrer('Enigma2'), null);
  assert.equal(cleanReferrer('dens.tv/tv-local'), null);
  assert.equal(cleanReferrer('ftp://x.example/'), null);
  assert.equal(cleanReferrer(null), null);
});

test('qualityRank lee la altura de la calidad', () => {
  assert.equal(qualityRank('1080p'), 1080);
  assert.equal(qualityRank('720i'), 720);
  assert.equal(qualityRank(null), 0);
  assert.equal(qualityRank('HD'), 0);
});

test('isUsableUrl: http(s), con host, sin espacios y sin destinos locales', () => {
  assert.equal(isUsableUrl('http://190.61.47.54:8000/live.m3u8'), true);
  assert.equal(isUsableUrl('https://cdn.example.com/a.m3u8'), true);
  assert.equal(isUsableUrl('rtmp://cdn.example.com/live'), false);
  assert.equal(isUsableUrl('http://127.0.0.1/a.m3u8'), false);
  assert.equal(isUsableUrl('http://localhost:8080/a.m3u8'), false);
  assert.equal(isUsableUrl('http://169.254.1.1/a.m3u8'), false);
  assert.equal(isUsableUrl('http://cdn.example.com/a b.m3u8'), false);
  assert.equal(isUsableUrl('no es una url'), false);
});

test('parsePlaylist distingue maestro, medios, vacío e inválido, y resuelve la variante', () => {
  const master = parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nhttps://other.example/hi.m3u8\n', 'https://cdn.example.com/live/master.m3u8');
  assert.equal(master.kind, 'master');
  assert.deepEqual(master.variants, ['https://cdn.example.com/live/low/index.m3u8', 'https://other.example/hi.m3u8']);
  const media = parsePlaylist('﻿#EXTM3U\r\n#EXT-X-KEY:METHOD=AES-128,URI="k"\r\n#EXTINF:6,\r\na.ts\r\n#EXTINF:6,\r\nb.ts\r\n', 'https://x.example/m.m3u8');
  assert.equal(media.kind, 'media');
  assert.equal(media.segments, 2);
  assert.equal(media.encrypted, true);
  assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n', 'https://x.example/').kind, 'empty');
  assert.equal(parsePlaylist('<html>404</html>', 'https://x.example/').kind, 'invalid');
});

test('looksLikeTs reconoce un flujo MPEG-TS', () => {
  const ts = Buffer.alloc(376);
  ts[0] = 0x47;
  ts[188] = 0x47;
  assert.equal(looksLikeTs(ts), true);
  assert.equal(looksLikeTs(Buffer.from('#EXTM3U')), false);
  const notTs = Buffer.alloc(376);
  notTs[0] = 0x47;
  assert.equal(looksLikeTs(notTs), false);
});
