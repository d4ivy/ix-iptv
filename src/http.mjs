import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/**
 * GET mínimo para Node 16 (sin `fetch`): redirecciones manuales, un tiempo máximo por petición (conexión, respuesta y cuerpo),
 * un tope de bytes y descompresión según `Content-Encoding`. TLS estricto: la validación por defecto de Node, sin excepciones,
 * como la de cualquier cliente bien configurado.
 */

export class FetchError extends Error {
  /** @param {string} reason código corto y estable (`timeout`, `http_404`, `tls`…) */
  constructor(reason, message) {
    super(message ?? reason);
    this.name = 'FetchError';
    this.reason = reason;
  }
}

const TLS_CODES = /^(CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_TLS_|ERR_SSL_|HOSTNAME_MISMATCH)/;

/** Traduce un error de red de Node a un motivo corto. */
export function classifyError(error) {
  if (error instanceof FetchError) return error.reason;
  const code = String((error && error.code) || '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') return 'reset';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'unreachable';
  if (TLS_CODES.test(code)) return 'tls';
  if (code === 'ERR_INVALID_URL' || code === 'ERR_INVALID_PROTOCOL' || code === 'ERR_INVALID_CHAR') return 'bad_url';
  return 'network';
}

function getOnce(url, { headers, timeoutMs, maxBytes, acceptEncoding }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new FetchError('bad_url'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new FetchError('bad_scheme'));
      return;
    }
    const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    let timer;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    let req;
    try {
      req = request(parsed, { method: 'GET', agent: false, headers: { ...headers, 'Accept-Encoding': acceptEncoding, Connection: 'close' } });
    } catch (error) {
      reject(error);
      return;
    }
    timer = setTimeout(() => req.destroy(new FetchError('timeout')), timeoutMs);
    req.on('error', (error) => finish(reject, error));
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
        res.resume();
        finish(resolve, { status, headers: res.headers, location, body: Buffer.alloc(0) });
        req.destroy();
        return;
      }
      const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
      let stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(createInflate());
      else if (encoding === 'br') stream = res.pipe(createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          finish(reject, new FetchError('too_large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => finish(resolve, { status, headers: res.headers, body: Buffer.concat(chunks) }));
      if (stream !== res) stream.on('error', () => finish(reject, new FetchError('bad_encoding')));
      res.on('error', (error) => finish(reject, error));
      res.on('aborted', () => finish(reject, new FetchError('reset')));
    });
    req.end();
  });
}

/**
 * `GET` con redirecciones (hasta `maxRedirects`). Devuelve `{ status, headers, body, finalUrl, redirects }`; los fallos de red
 * se lanzan (`classifyError` los traduce). `timeoutMs` vale para cada petición de la cadena.
 */
export async function httpGet(url, options = {}) {
  const opts = {
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? 8000,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    acceptEncoding: options.acceptEncoding ?? 'identity',
  };
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;
  for (let redirects = 0; ; redirects++) {
    const res = await getOnce(current, opts);
    if (res.location !== undefined) {
      if (redirects >= maxRedirects) throw new FetchError('too_many_redirects');
      try {
        current = new URL(res.location, current).href;
      } catch {
        throw new FetchError('bad_redirect');
      }
      continue;
    }
    return { status: res.status, headers: res.headers, body: res.body, finalUrl: current, redirects };
  }
}
