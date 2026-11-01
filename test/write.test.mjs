import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildCandidates, sourceKey } from '../src/merge.mjs';
import { verifyOutput } from '../src/verify.mjs';
import { buildOutput, SCHEMA, spanishCountryName, writeOutput } from '../src/write.mjs';
import { fixtureApi, withTempDir } from './helpers.mjs';

function sampleOutput() {
  const api = fixtureApi();
  const { candidates } = buildCandidates(api);
  const dead = new Set(['https://cdn.example.com/norte-1080b.m3u8', 'https://cdn.example.com/vida.m3u8']);
  const results = new Map();
  for (const candidate of candidates) for (const source of candidate.sources) results.set(sourceKey(source), { ok: !dead.has(source.url) });
  return buildOutput({ candidates, results, countries: api.countries, generatedAt: '2026-11-01T02:00:00.000Z', defaultUserAgent: 'UA', totals: { candidates: candidates.length } });
}

test('spanishCountryName traduce con ICU y entiende el UK de iptv-org', () => {
  assert.equal(spanishCountryName('MX', 'Mexico'), 'México');
  assert.equal(spanishCountryName('US', 'United States'), 'Estados Unidos');
  assert.equal(spanishCountryName('UK', 'United Kingdom'), 'Reino Unido');
  assert.equal(spanishCountryName('ZZZ', 'Nowhere'), 'Nowhere');
});

test('buildOutput publica solo las URL vivas y los canales con alguna', () => {
  const output = sampleOutput();
  const mx = output.countries.get('MX');
  assert.equal(mx.schema, SCHEMA);
  assert.deepEqual(mx.channels.map((channel) => channel.id), ['NorteTV.mx@SD'], 'Vida no tiene ninguna URL viva');
  assert.deepEqual(
    mx.channels[0].sources.map((source) => source.url),
    ['https://cdn.example.com/norte-1080.m3u8', 'https://cdn.example.com/norte-720.m3u8'],
  );
  assert.deepEqual(Object.keys(mx.channels[0].sources[0]), ['url'], 'sin campos internos (calidad, etiquetas)');
  const us = output.countries.get('US');
  assert.equal(us.channels[0].sources[0].referrer, 'https://hbo.example.com/');
  assert.deepEqual(output.index.countries, [
    { code: 'US', name: 'Estados Unidos', spanish: false, channels: 1 },
    { code: 'MX', name: 'México', spanish: true, channels: 1 },
  ]);
  assert.equal(output.index.totals.channels, 2);
  assert.equal(output.index.totals.liveSources, 4);
  assert.equal(output.index.defaultUserAgent, 'UA');
  assert.deepEqual(output.search.channels, [
    ['NorteTV.mx@SD', 'Norte TV', 'MX', ['Norte Televisión'], 'https://img.example.com/norte.png'],
    ['HBO.us@East', 'HBO', 'US', [], 'https://img.example.com/hbo-east.svg'], // con logo, los alias van aunque estén vacíos
  ]);
});

test('writeOutput escribe los archivos y verifyOutput los acepta', () =>
  withTempDir(async (dir) => {
    await writeFile(join(dir, 'leeme.txt'), 'no se toca');
    await writeOutput(dir, sampleOutput(), { ok: true });
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    assert.equal(index.countries.length, 2);
    assert.ok((await readFile(join(dir, 'countries', 'mx.json'), 'utf8')).includes('Norte TV'));
    assert.equal(await readFile(join(dir, 'leeme.txt'), 'utf8'), 'no se toca');
    const { problems, summary } = await verifyOutput(dir, { minChannels: 2 });
    assert.deepEqual(problems, []);
    assert.equal(summary.channels, 2);
    assert.equal((await verifyOutput(dir, { minChannels: 3 })).problems.length, 1, 'por debajo del mínimo no se publica');
  }));

test('verifyOutput detecta un país roto, un índice incoherente y un esquema distinto', () =>
  withTempDir(async (dir) => {
    await writeOutput(dir, sampleOutput());
    await writeFile(join(dir, 'countries', 'us.json'), '{"schema":1,"country":"US","channels":[]}');
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    index.schema = 2;
    await writeFile(join(dir, 'index.json'), JSON.stringify(index));
    const { problems } = await verifyOutput(dir);
    assert.ok(problems.some((problem) => problem.includes('schema 2')));
    assert.ok(problems.some((problem) => problem.includes('us.json: 0 canales')));
    assert.ok(problems.some((problem) => problem.includes('search.json')));
  }));

test('verifyOutput sin índice no revienta', () =>
  withTempDir(async (dir) => {
    const { problems, summary } = await verifyOutput(dir);
    assert.equal(summary, null);
    assert.equal(problems.length, 1);
  }));
