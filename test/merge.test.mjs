import assert from 'node:assert/strict';
import test from 'node:test';
import { checkShape, SchemaError } from '../src/api.mjs';
import { buildCandidates, sourceKey } from '../src/merge.mjs';
import { fixtureApi } from './helpers.mjs';

test('buildCandidates excluye lo que no se puede publicar y lo cuenta', () => {
  const { candidates, stats } = buildCandidates(fixtureApi());
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort(), ['HBO.us@East', 'NorteTV.mx@SD', 'Vida.mx@SD']);
  assert.equal(stats.noChannel, 1);
  assert.equal(stats.unknownChannel, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.nsfw, 1);
  assert.equal(stats.closed, 1);
  assert.equal(stats.badUrl, 2);
  assert.equal(stats.duplicateUrl, 1);
  assert.equal(stats.unknownFeed, 1);
});

test('un canal junta todas sus URL ordenadas por calidad y, a igualdad, primero las 24/7', () => {
  const { candidates } = buildCandidates(fixtureApi());
  const norte = candidates.find((candidate) => candidate.id === 'NorteTV.mx@SD');
  assert.deepEqual(
    norte.sources.map((source) => source.url),
    ['https://cdn.example.com/norte-1080b.m3u8', 'https://cdn.example.com/norte-1080.m3u8', 'https://cdn.example.com/norte-720.m3u8'],
  );
  assert.equal(norte.name, 'Norte TV');
  assert.equal(norte.country, 'MX');
  assert.deepEqual(norte.languages, ['spa']);
  assert.deepEqual(norte.altNames, ['Norte Televisión']);
  assert.equal(norte.logo, 'https://img.example.com/norte.png', 'el logo en uso gana al que no lo está');
});

test('las cabeceras sucias se limpian y un feed desconocido cae en el principal', () => {
  const { candidates } = buildCandidates(fixtureApi());
  const vida = candidates.find((candidate) => candidate.id === 'Vida.mx@SD');
  assert.equal(vida.sources[0].userAgent, 'Mozilla/5.0 CrKey/1.44');
  assert.equal(vida.sources[0].referrer, undefined, '«No response» no es un Referer');
  const hbo = candidates.find((candidate) => candidate.id === 'HBO.us@East');
  assert.deepEqual(
    hbo.sources.map((source) => source.url),
    ['https://cdn.example.com/hbo-east.m3u8', 'https://cdn.example.com/hbo-unknown-feed.m3u8'],
  );
  assert.equal(hbo.sources[0].referrer, 'https://hbo.example.com/');
  assert.equal(hbo.logo, 'https://img.example.com/hbo-east.svg', 'el logo del propio feed gana');
});

test('--countries limita el cruce a los países de origen del canal', () => {
  const { candidates, stats } = buildCandidates(fixtureApi(), { countries: ['mx'] });
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort(), ['NorteTV.mx@SD', 'Vida.mx@SD']);
  assert.ok(stats.otherCountry >= 2);
});

test('sourceKey distingue la misma URL con otras cabeceras', () => {
  assert.notEqual(sourceKey({ url: 'https://a/x.m3u8' }), sourceKey({ url: 'https://a/x.m3u8', userAgent: 'UA' }));
  assert.equal(sourceKey({ url: 'https://a/x.m3u8' }), sourceKey({ url: 'https://a/x.m3u8' }));
});

test('checkShape tolera unas pocas filas malas y aborta si cambia el esquema', () => {
  const good = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, name: 'C' }));
  assert.equal(checkShape('categories', [...good, { id: 1 }]).invalid, 1);
  assert.throws(() => checkShape('categories', [...good.slice(0, 10), { id: 1 }]), SchemaError);
  assert.throws(() => checkShape('streams', { nope: true }), SchemaError);
  // iptv-org renombró `label` → `labels` (2026-09-18): un archivo entero con la forma vieja tiene que abortar
  const renamed = Array.from({ length: 10 }, () => ({ channel: null, feed: null, url: 'https://a', quality: null, referrer: null, user_agent: null, labels: 'Geo-blocked' }));
  assert.throws(() => checkShape('streams', renamed), SchemaError);
});
