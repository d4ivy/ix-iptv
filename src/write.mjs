import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sourceKey } from './merge.mjs';

/**
 * Salida publicada (esquema propio y versionado, del que dependen quienes consumen la lista):
 *
 * - `index.json`: `{ schema, generatedAt, source, defaultUserAgent, totals, countries: [{ code, name, spanish, channels }] }`, con los
 *   países ordenados por número de canales y su nombre en español.
 * - `countries/<cc>.json`: `{ schema, generatedAt, country, channels: [{ id, name, logo?, categories, languages, sources }] }`, solo los
 *   canales con al menos una URL viva y solo sus URL vivas, en orden de preferencia; cada fuente `{ url, referrer?, userAgent? }`.
 * - `search.json`: `{ schema, generatedAt, channels: [[id, name, country, altNames?, logo?]] }`, el índice ligero para buscar (`altNames`
 *   va, aunque esté vacío, si hay `logo`).
 * - `report.json`: el resumen de la ejecución.
 */

export const SCHEMA = 1;

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' });
  } catch {
    return null;
  }
})();
/** iptv-org usa `UK` para el Reino Unido (ISO: `GB`). */
const REGION_ALIASES = { UK: 'GB' };

/** El nombre del país en español (ICU de Node), o el de la fuente si no lo conoce. */
export function spanishCountryName(code, fallback) {
  const iso = REGION_ALIASES[code] ?? code;
  try {
    const name = regionNames === null ? undefined : regionNames.of(iso);
    if (typeof name === 'string' && name !== '' && name !== iso) return name;
  } catch {
    // código que ICU no admite
  }
  return fallback || code;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/**
 * `{ index, countries: Map<code, archivo>, search }` a partir de los candidatos y de los resultados por `sourceKey`.
 */
export function buildOutput({ candidates, results, countries, generatedAt, defaultUserAgent, totals = {} }) {
  const countryInfo = new Map(countries.map((country) => [country.code, country]));
  const perCountry = new Map();
  let liveSources = 0;
  for (const candidate of candidates) {
    const sources = candidate.sources
      .filter((source) => results.get(sourceKey(source))?.ok === true)
      .map((source) => ({ url: source.url, ...(source.referrer === undefined ? {} : { referrer: source.referrer }), ...(source.userAgent === undefined ? {} : { userAgent: source.userAgent }) }));
    if (sources.length === 0) continue;
    liveSources += sources.length;
    const channel = {
      id: candidate.id,
      name: candidate.name,
      ...(candidate.logo === undefined ? {} : { logo: candidate.logo }),
      categories: candidate.categories,
      languages: candidate.languages,
      sources,
    };
    const list = perCountry.get(candidate.country);
    if (list === undefined) perCountry.set(candidate.country, [channel]);
    else list.push(channel);
  }

  const files = new Map();
  const index = [];
  const search = [];
  const altNamesById = new Map(candidates.map((candidate) => [candidate.id, candidate.altNames ?? []]));
  let channelCount = 0;
  for (const [code, channels] of perCountry) {
    channels.sort(byName);
    files.set(code, { schema: SCHEMA, generatedAt, country: code, channels });
    const info = countryInfo.get(code);
    index.push({ code, name: spanishCountryName(code, info?.name), spanish: (info?.languages ?? []).includes('spa'), channels: channels.length });
    channelCount += channels.length;
    for (const channel of channels) {
      const altNames = altNamesById.get(channel.id) ?? [];
      const entry = [channel.id, channel.name, code];
      if (altNames.length > 0 || channel.logo !== undefined) entry.push(altNames);
      if (channel.logo !== undefined) entry.push(channel.logo);
      search.push(entry);
    }
  }
  index.sort((a, b) => b.channels - a.channels || a.name.localeCompare(b.name, 'es'));
  return {
    index: {
      schema: SCHEMA,
      generatedAt,
      source: 'iptv-org',
      defaultUserAgent,
      totals: { ...totals, channels: channelCount, liveSources, countries: index.length },
      countries: index,
    },
    countries: files,
    search: { schema: SCHEMA, generatedAt, channels: search },
  };
}

/** Escribe la salida en `dir` (borra antes solo los `countries/*.json` que deja esta herramienta). */
export async function writeOutput(dir, output, report) {
  const countriesDir = join(dir, 'countries');
  await mkdir(countriesDir, { recursive: true });
  for (const name of await readdir(countriesDir)) if (/^[a-z]{2,3}\.json$/.test(name)) await rm(join(countriesDir, name));
  for (const [code, file] of output.countries) await writeFile(join(countriesDir, `${code.toLowerCase()}.json`), JSON.stringify(file));
  await writeFile(join(dir, 'search.json'), JSON.stringify(output.search));
  if (report !== undefined) await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  // el índice, el último: quien lo lea encuentra ya todos los archivos que nombra
  await writeFile(join(dir, 'index.json'), JSON.stringify(output.index));
}
