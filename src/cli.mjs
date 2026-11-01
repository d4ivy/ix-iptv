#!/usr/bin/env node
import { DEFAULT_API_BASE, loadApi } from './api.mjs';
import { buildCandidates, sourceKey } from './merge.mjs';
import { DEFAULT_USER_AGENT, hostOf, runPool, validateSource } from './validate.mjs';
import { buildOutput, writeOutput } from './write.mjs';

/**
 * `node src/cli.mjs --out <dir> [opciones]`: lee la API de iptv-org, valida todas las URL y escribe la lista publicada.
 *
 *   --out <dir>          carpeta de salida (obligatoria)
 *   --api <url>          base de la API (por defecto https://iptv-org.github.io/api)
 *   --api-dir <dir>      leer la API de copias locales en lugar de la red
 *   --countries MX,AR    solo esos países de origen
 *   --concurrency 32     peticiones a la vez en total
 *   --per-host 2         peticiones a la vez por host
 *   --host-gap 150       ms de pausa entre dos peticiones al mismo host
 *   --timeout 8000       ms por petición
 *   --limit <n>          validar como mucho n fuentes (pruebas rápidas)
 *   --min-channels <n>   salir con error si quedan menos canales vivos
 */

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!name.startsWith('--')) throw new Error(`argumento inesperado: ${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`falta el valor de ${name}`);
    args[name.slice(2)] = value;
    i++;
  }
  return args;
}

const int = (value, fallback) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`número inválido: ${value}`);
  return parsed;
};

const log = (message) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${message}\n`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.out === undefined) throw new Error('falta --out <dir>');
  const options = {
    concurrency: int(args.concurrency, 32),
    perHost: int(args['per-host'], 2),
    hostGapMs: int(args['host-gap'], 150),
    timeoutMs: int(args.timeout, 8000),
    limit: int(args.limit, Number.POSITIVE_INFINITY),
    minChannels: int(args['min-channels'], 1),
  };
  const started = Date.now();
  const generatedAt = new Date().toISOString();

  log(`leyendo la API (${args['api-dir'] ?? args.api ?? DEFAULT_API_BASE})`);
  const { data, invalid } = await loadApi({ base: args.api ?? DEFAULT_API_BASE, ...(args['api-dir'] === undefined ? {} : { apiDir: args['api-dir'] }) });
  const countries = args.countries === undefined ? [] : args.countries.split(',').map((code) => code.trim()).filter(Boolean);
  const { candidates, stats } = buildCandidates(data, { countries });
  log(`${stats.candidates} canales candidatos con ${stats.sources} URL (de ${stats.streams} streams)`);

  const unique = new Map();
  for (const candidate of candidates) for (const source of candidate.sources) if (!unique.has(sourceKey(source))) unique.set(sourceKey(source), source);
  const sources = [...unique.values()].slice(0, options.limit);
  let lastPercent = -1;
  const outcomes = await runPool(sources, (source) => validateSource(source, { timeoutMs: options.timeoutMs, defaultUserAgent: DEFAULT_USER_AGENT }), {
    concurrency: options.concurrency,
    perHost: options.perHost,
    hostGapMs: options.hostGapMs,
    getHost: (source) => hostOf(source.url),
    onDone: (done, total) => {
      const percent = Math.floor((done / total) * 20) * 5;
      if (percent !== lastPercent) {
        lastPercent = percent;
        log(`validadas ${done}/${total} (${percent} %)`);
      }
    },
  });
  const results = new Map();
  const reasons = {};
  let ok = 0;
  sources.forEach((source, index) => {
    const outcome = outcomes[index];
    results.set(sourceKey(source), outcome);
    if (outcome.ok) ok++;
    else {
      const key = `${outcome.stage ?? '?'}:${outcome.reason}`;
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  });

  const output = buildOutput({ candidates, results, countries: data.countries, generatedAt, defaultUserAgent: DEFAULT_USER_AGENT, totals: { candidates: stats.candidates, sources: sources.length } });
  const report = {
    generatedAt,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    options: { ...options, limit: Number.isFinite(options.limit) ? options.limit : null, countries },
    invalidRows: invalid,
    merge: stats,
    validation: { sources: sources.length, ok, failed: sources.length - ok, reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])) },
    output: output.index.totals,
  };
  await writeOutput(args.out, output, report);
  log(`listo en ${report.durationSeconds} s: ${output.index.totals.channels} canales vivos de ${stats.candidates} en ${output.index.totals.countries} países (${ok}/${sources.length} URL vivas)`);
  if (output.index.totals.channels < options.minChannels) {
    log(`ERROR: menos de ${options.minChannels} canales vivos`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
