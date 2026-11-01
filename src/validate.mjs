import { setTimeout as sleep } from 'node:timers/promises';
import { looksLikeTs, parsePlaylist } from './hls.mjs';
import { classifyError, FetchError, httpGet } from './http.mjs';

/**
 * Validación de una fuente: se pide el manifiesto con las cabeceras de la fuente y, si es un maestro, su primera variante; vale si
 * se llega a un playlist de medios con segmentos. En la medición del 2026-11-01 (266 streams) el 96–98 % de lo que pasaba esas dos
 * etapas entregaba además un segmento válido, así que no se descargan segmentos (la validación completa del mundo cabe en una Action).
 */

/**
 * El User-Agent de las fuentes que no traen uno propio. Lo publica `index.json` en `defaultUserAgent`: el cliente debe usar **este
 * mismo** para pedir lo que aquí se validó.
 */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** El tope de un playlist: más grande no es un HLS razonable. */
export const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;

export function requestHeaders(source, defaultUserAgent = DEFAULT_USER_AGENT) {
  return { 'User-Agent': source.userAgent ?? defaultUserAgent, Accept: '*/*', ...(source.referrer === undefined ? {} : { Referer: source.referrer }) };
}

async function fetchPlaylist(url, headers, timeoutMs) {
  const res = await httpGet(url, { headers, timeoutMs, maxBytes: PLAYLIST_MAX_BYTES });
  if (res.status < 200 || res.status >= 300) throw new FetchError(`http_${res.status}`);
  if (looksLikeTs(res.body)) throw new FetchError('not_hls');
  const playlist = parsePlaylist(res.body.toString('utf8'), res.finalUrl);
  if (playlist.kind === 'invalid') throw new FetchError('not_playlist');
  if (playlist.kind === 'empty') throw new FetchError('empty_playlist');
  return playlist;
}

/** `{ ok: true, kind, encrypted, ms }` o `{ ok: false, stage, reason, ms }`. Nunca lanza. */
export async function validateSource(source, { timeoutMs = 8000, defaultUserAgent = DEFAULT_USER_AGENT } = {}) {
  const started = Date.now();
  const headers = requestHeaders(source, defaultUserAgent);
  let stage = 'manifest';
  try {
    const entry = await fetchPlaylist(source.url, headers, timeoutMs);
    let encrypted = entry.encrypted;
    if (entry.kind === 'master') {
      stage = 'variant';
      const variant = await fetchPlaylist(entry.variants[0], headers, timeoutMs);
      if (variant.kind !== 'media') throw new FetchError('nested_master');
      encrypted = variant.encrypted;
    }
    return { ok: true, kind: entry.kind, encrypted, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, stage, reason: classifyError(error), ms: Date.now() - started };
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Ejecuta `worker` sobre `items` con un máximo global (`concurrency`) y otro por host (`perHost`), con una pausa entre dos
 * peticiones seguidas al mismo host (`hostGapMs`): cortesía con los orígenes pequeños, que en la lista son muchos (4 199 hosts).
 * Devuelve los resultados en el orden de `items`. Si `worker` lanza, el resultado es `{ ok: false, reason: 'internal' }`.
 */
export async function runPool(items, worker, { concurrency = 16, perHost = 2, hostGapMs = 150, getHost = (item) => item, onDone } = {}) {
  const byHost = new Map();
  items.forEach((item, index) => {
    const host = getHost(item);
    const queue = byHost.get(host);
    if (queue === undefined) byHost.set(host, [{ item, index }]);
    else queue.push({ item, index });
  });
  const results = new Array(items.length);
  let active = 0;
  const waiters = [];
  const acquire = () => {
    if (active < concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  const release = () => {
    const next = waiters.shift();
    if (next !== undefined) next();
    else active--;
  };
  let done = 0;
  const lanes = [];
  for (const queue of byHost.values()) {
    let cursor = 0;
    const lane = async () => {
      while (cursor < queue.length) {
        const { item, index } = queue[cursor++];
        await acquire();
        try {
          results[index] = await worker(item);
        } catch {
          results[index] = { ok: false, reason: 'internal' };
        } finally {
          release();
        }
        done++;
        if (onDone !== undefined) onDone(done, items.length);
        if (hostGapMs > 0 && cursor < queue.length) await sleep(hostGapMs);
      }
    };
    for (let i = 0; i < Math.min(perHost, queue.length); i++) lanes.push(lane());
  }
  await Promise.all(lanes);
  return results;
}
