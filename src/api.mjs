import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FetchError, httpGet } from './http.mjs';

/**
 * Lectura de la API de iptv-org (`https://iptv-org.github.io/api/<archivo>.json`). Su esquema **no está versionado** (unos diez
 * cambios incompatibles desde 2025): cada archivo se comprueba campo a campo y, si demasiadas filas no tienen la forma esperada,
 * se aborta con un error claro. Así la Action falla en rojo y la última lista buena sigue publicada.
 */

export const DEFAULT_API_BASE = 'https://iptv-org.github.io/api';
export const API_FILES = ['streams', 'channels', 'feeds', 'logos', 'blocklist', 'countries', 'categories'];
/** Tolerancia: filas con forma inesperada que se descartan sin abortar. */
export const MAX_INVALID_RATIO = 0.02;

const str = (value) => typeof value === 'string';
const strOrNull = (value) => value === null || typeof value === 'string';
const strArray = (value) => Array.isArray(value) && value.every(str);

/** Qué tiene que traer cada fila (solo lo que usa el validador). */
export const SHAPES = {
  streams: (row) => strOrNull(row.channel) && strOrNull(row.feed) && str(row.url) && strOrNull(row.quality) && strOrNull(row.referrer) && strOrNull(row.user_agent) && strArray(row.labels ?? []),
  channels: (row) => str(row.id) && str(row.name) && str(row.country) && strArray(row.categories) && typeof row.is_nsfw === 'boolean' && strOrNull(row.closed) && strArray(row.alt_names ?? []),
  feeds: (row) => str(row.channel) && str(row.id) && str(row.name) && typeof row.is_main === 'boolean' && strArray(row.languages),
  logos: (row) => str(row.channel) && strOrNull(row.feed) && str(row.url) && typeof row.in_use === 'boolean',
  blocklist: (row) => str(row.channel),
  countries: (row) => str(row.code) && str(row.name) && strArray(row.languages),
  categories: (row) => str(row.id) && str(row.name),
};

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Filtra las filas válidas de un archivo; lanza `SchemaError` si no es un array o si fallan más del 2 %. */
export function checkShape(name, data) {
  if (!Array.isArray(data)) throw new SchemaError(`${name}.json no es un array`);
  const shape = SHAPES[name];
  const valid = [];
  for (const row of data) if (row !== null && typeof row === 'object' && shape(row)) valid.push(row);
  const invalid = data.length - valid.length;
  if (data.length === 0 || invalid / data.length > MAX_INVALID_RATIO) {
    throw new SchemaError(`${name}.json: ${invalid} de ${data.length} filas no tienen la forma esperada (¿cambió el esquema de iptv-org?)`);
  }
  return { rows: valid, invalid };
}

async function readRemote(base, name) {
  const res = await httpGet(`${base}/${name}.json`, { timeoutMs: 120000, maxBytes: 128 * 1024 * 1024, acceptEncoding: 'gzip', headers: { 'User-Agent': 'iptv-validated' } });
  if (res.status !== 200) throw new FetchError(`http_${res.status}`, `${name}.json respondió ${res.status}`);
  return res.body.toString('utf8');
}

/**
 * Carga los siete archivos: de `apiDir` (copias locales, para pruebas y desarrollo) o de `base`. Devuelve
 * `{ data: { streams, channels, … }, invalid: { streams: n, … } }`.
 */
export async function loadApi({ base = DEFAULT_API_BASE, apiDir } = {}) {
  const data = {};
  const invalid = {};
  for (const name of API_FILES) {
    const text = apiDir === undefined ? await readRemote(base, name) : await readFile(join(apiDir, `${name}.json`), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SchemaError(`${name}.json no es JSON válido`);
    }
    const checked = checkShape(name, parsed);
    data[name] = checked.rows;
    invalid[name] = checked.invalid;
  }
  return { data, invalid };
}
