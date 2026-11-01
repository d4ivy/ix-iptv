/**
 * Lo justo de HLS para validar: ¿es un playlist?, ¿maestro o de medios?, la primera variante y cuántos segmentos trae. Un flujo
 * MPEG-TS continuo (byte de sincronía 0x47) no es HLS y no se publica.
 */

const PLAYLIST_HEADER = /^﻿?\s*#EXTM3U/;

/** `true` si el cuerpo empieza como un flujo MPEG-TS (0x47 y, si hay bytes, otra sincronía a los 188). */
export function looksLikeTs(buffer) {
  return buffer.length >= 1 && buffer[0] === 0x47 && (buffer.length < 189 || buffer[188] === 0x47);
}

function resolveUri(reference, baseUrl) {
  try {
    return new URL(reference, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * `{ kind, variants, segments, encrypted }`: `kind` es `master` (con al menos una variante), `media` (con segmentos), `empty`
 * (un playlist sin segmentos ni variantes) o `invalid` (no empieza por `#EXTM3U`). Las variantes salen resueltas contra `baseUrl`.
 */
export function parsePlaylist(text, baseUrl) {
  if (!PLAYLIST_HEADER.test(text)) return { kind: 'invalid', variants: [], segments: 0, encrypted: false };
  const variants = [];
  let segments = 0;
  let encrypted = false;
  let expectVariant = false;
  let expectSegment = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-STREAM-INF')) expectVariant = true;
      else if (line.startsWith('#EXTINF')) expectSegment = true;
      else if (line.startsWith('#EXT-X-KEY') && !/METHOD=NONE/i.test(line)) encrypted = true;
      continue;
    }
    if (expectVariant) {
      const absolute = resolveUri(line, baseUrl);
      if (absolute !== null) variants.push(absolute);
      expectVariant = false;
    } else if (expectSegment) {
      segments++;
      expectSegment = false;
    }
  }
  if (variants.length > 0) return { kind: 'master', variants, segments: 0, encrypted };
  return { kind: segments > 0 ? 'media' : 'empty', variants: [], segments, encrypted };
}
