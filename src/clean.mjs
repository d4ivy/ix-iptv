/**
 * Limpieza de los datos de la fuente: iptv-org trae cabeceras sucias (32 `user_agent` con el prefijo `#EXTVLCOPT:` dentro y
 * `referrer` que no son una URL, medido el 2026-11-01). Lo que no se pueda usar se descarta (`null`): una cabecera mal formada
 * haría fallar la petición o la rechazaría el cliente.
 */

const VLC_USER_AGENT = /^\s*#EXTVLCOPT:\s*http-user-agent\s*=\s*/i;
const VLC_REFERRER = /^\s*#EXTVLCOPT:\s*http-referr?er\s*=\s*/i;

function stripPrefix(value, prefix) {
  let out = value;
  while (prefix.test(out)) out = out.replace(prefix, '');
  return out;
}

export function cleanUserAgent(raw) {
  if (typeof raw !== 'string') return null;
  const value = stripPrefix(raw, VLC_USER_AGENT).trim().replace(/^"(.*)"$/, '$1').trim();
  if (value === '' || value.length > 512 || /[\r\n\0]/.test(value)) return null;
  return value;
}

/** Un Referer solo vale si es una URL `http(s)` (se devuelve tal cual, sin normalizar: hay orígenes que lo comparan literal). */
export function cleanReferrer(raw) {
  if (typeof raw !== 'string') return null;
  const value = stripPrefix(raw, VLC_REFERRER).trim();
  if (value === '' || value.length > 1024 || /[\s\0]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Altura de la calidad (`1080p`, `720i`…) para ordenar; `0` si no se sabe. */
export function qualityRank(quality) {
  const match = /(\d{3,4})\s*[pi]/i.exec(typeof quality === 'string' ? quality : '');
  return match ? Number(match[1]) : 0;
}

const LOCAL_HOST = /^(localhost|0\.0\.0\.0|::1?|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|fe80:.*)$/i;

/** `true` si la URL es `http(s)`, con host, sin espacios ni caracteres de control y sin destino local (nunca es un origen de stream). */
export function isUsableUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\0]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host !== '' && !LOCAL_HOST.test(host);
  } catch {
    return false;
  }
}
