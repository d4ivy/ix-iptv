import { cleanReferrer, cleanUserAgent, isUsableUrl, qualityRank } from './clean.mjs';

/**
 * Cruce de la API en «candidatos»: un candidato es un canal en uno de sus feeds (`<canal>@<feed>`, la misma unidad que una entrada
 * de `index.m3u`) con **todas** sus URLs (las de respaldo incluidas, que `index.m3u` no trae). Se excluyen los streams sin canal o
 * con un canal desconocido, los canales de la blocklist, NSFW o cerrados, y las URL que no son `http(s)` o apuntan a un destino local.
 */

function pickLogo(logos, feedId) {
  let best = null;
  let bestScore = -Infinity;
  for (const logo of logos) {
    if (!isUsableUrl(logo.url)) continue;
    const format = String(logo.format ?? '').toUpperCase();
    let score = 0;
    if (logo.feed === feedId) score += 8;
    else if (logo.feed === null) score += 4;
    else continue;
    if (logo.in_use) score += 2;
    if (format === 'PNG' || format === 'JPEG' || format === 'WEBP') score += 1;
    // a igualdad, el ancho más cercano a 400 px (un tamaño útil para una tarjeta)
    const width = typeof logo.width === 'number' ? logo.width : 0;
    score -= Math.abs(width - 400) / 100000;
    if (score > bestScore) {
      best = logo.url;
      bestScore = score;
    }
  }
  return best;
}

/**
 * `{ candidates, stats }`. `options.countries` (códigos en mayúsculas) limita el cruce a esos países de origen del canal.
 * Las URL de cada candidato van ordenadas por calidad (de mayor a menor) y, a igualdad, primero las que no son «Not 24/7».
 */
export function buildCandidates(api, options = {}) {
  const only = options.countries === undefined || options.countries.length === 0 ? null : new Set(options.countries.map((code) => code.toUpperCase()));
  const stats = { streams: api.streams.length, noChannel: 0, unknownChannel: 0, blocked: 0, nsfw: 0, closed: 0, badUrl: 0, otherCountry: 0, unknownFeed: 0, duplicateUrl: 0, sources: 0, candidates: 0 };
  const blocked = new Set(api.blocklist.map((row) => row.channel));
  const channels = new Map(api.channels.map((row) => [row.id, row]));
  const feedsByChannel = new Map();
  for (const feed of api.feeds) {
    const list = feedsByChannel.get(feed.channel);
    if (list === undefined) feedsByChannel.set(feed.channel, [feed]);
    else list.push(feed);
  }
  const logosByChannel = new Map();
  for (const logo of api.logos) {
    const list = logosByChannel.get(logo.channel);
    if (list === undefined) logosByChannel.set(logo.channel, [logo]);
    else list.push(logo);
  }

  const byKey = new Map();
  for (const stream of api.streams) {
    if (stream.channel === null) {
      stats.noChannel++;
      continue;
    }
    const channel = channels.get(stream.channel);
    if (channel === undefined) {
      stats.unknownChannel++;
      continue;
    }
    if (blocked.has(channel.id)) {
      stats.blocked++;
      continue;
    }
    if (channel.is_nsfw) {
      stats.nsfw++;
      continue;
    }
    if (channel.closed !== null) {
      stats.closed++;
      continue;
    }
    if (only !== null && !only.has(channel.country)) {
      stats.otherCountry++;
      continue;
    }
    if (!isUsableUrl(stream.url)) {
      stats.badUrl++;
      continue;
    }
    const feeds = feedsByChannel.get(channel.id) ?? [];
    const main = feeds.find((feed) => feed.is_main) ?? feeds[0] ?? null;
    let feed = stream.feed === null ? main : (feeds.find((candidate) => candidate.id === stream.feed) ?? null);
    if (feed === null && stream.feed !== null) {
      stats.unknownFeed++;
      feed = main;
    }
    const key = feed === null ? channel.id : `${channel.id}@${feed.id}`;
    let candidate = byKey.get(key);
    if (candidate === undefined) {
      const logo = pickLogo(logosByChannel.get(channel.id) ?? [], feed === null ? null : feed.id);
      candidate = {
        id: key,
        name: feed === null || feed.is_main ? channel.name : `${channel.name} ${feed.name}`.trim(),
        altNames: channel.alt_names ?? [],
        country: channel.country,
        categories: channel.categories,
        languages: feed === null ? [] : feed.languages,
        ...(logo === null ? {} : { logo }),
        sources: [],
      };
      byKey.set(key, candidate);
    }
    if (candidate.sources.some((source) => source.url === stream.url)) {
      stats.duplicateUrl++;
      continue;
    }
    const referrer = cleanReferrer(stream.referrer);
    const userAgent = cleanUserAgent(stream.user_agent);
    candidate.sources.push({
      url: stream.url,
      ...(referrer === null ? {} : { referrer }),
      ...(userAgent === null ? {} : { userAgent }),
      quality: qualityRank(stream.quality),
      notAlways: (stream.labels ?? []).includes('Not 24/7'),
    });
  }

  const candidates = [...byKey.values()];
  for (const candidate of candidates) {
    candidate.sources.sort((a, b) => b.quality - a.quality || Number(a.notAlways) - Number(b.notAlways));
    stats.sources += candidate.sources.length;
  }
  stats.candidates = candidates.length;
  return { candidates, stats };
}

/** Clave de una fuente para validarla una sola vez: la URL con las cabeceras con que se pide. */
export function sourceKey(source) {
  return `${source.url}\n${source.userAgent ?? ''}\n${source.referrer ?? ''}`;
}
