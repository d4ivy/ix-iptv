import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCHEMA } from './write.mjs';

/**
 * Comprobación de la salida antes de publicarla: si algo falla, la Action no publica y la última lista buena sigue en Pages.
 * Devuelve `{ problems, summary }` (`problems` vacío si todo está bien).
 */

async function readJson(path, problems) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    problems.push(`${path}: no se puede leer como JSON (${error.code ?? error.message})`);
    return null;
  }
}

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value);

export async function verifyOutput(dir, { minChannels = 1 } = {}) {
  const problems = [];
  const index = await readJson(join(dir, 'index.json'), problems);
  if (index === null) return { problems, summary: null };
  if (index.schema !== SCHEMA) problems.push(`index.json: schema ${index.schema} (se esperaba ${SCHEMA})`);
  if (typeof index.generatedAt !== 'string' || Number.isNaN(Date.parse(index.generatedAt))) problems.push('index.json: generatedAt no es una fecha');
  if (typeof index.defaultUserAgent !== 'string' || index.defaultUserAgent === '') problems.push('index.json: falta defaultUserAgent');
  const countries = Array.isArray(index.countries) ? index.countries : [];
  if (countries.length === 0) problems.push('index.json: no hay países');
  let channels = 0;
  for (const country of countries) {
    if (typeof country.code !== 'string' || !/^[A-Z]{2,3}$/.test(country.code)) {
      problems.push(`index.json: código de país inválido ${JSON.stringify(country.code)}`);
      continue;
    }
    const file = await readJson(join(dir, 'countries', `${country.code.toLowerCase()}.json`), problems);
    if (file === null) continue;
    if (file.schema !== SCHEMA || file.country !== country.code || !Array.isArray(file.channels)) {
      problems.push(`countries/${country.code.toLowerCase()}.json: cabecera inválida`);
      continue;
    }
    if (file.channels.length !== country.channels) problems.push(`countries/${country.code.toLowerCase()}.json: ${file.channels.length} canales, el índice dice ${country.channels}`);
    for (const channel of file.channels) {
      const ok = typeof channel.id === 'string' && typeof channel.name === 'string' && Array.isArray(channel.sources) && channel.sources.length > 0 && channel.sources.every((source) => isHttpUrl(source.url));
      if (!ok) {
        problems.push(`countries/${country.code.toLowerCase()}.json: canal inválido ${JSON.stringify(channel.id)}`);
        break;
      }
    }
    channels += file.channels.length;
  }
  const search = await readJson(join(dir, 'search.json'), problems);
  if (search !== null && (search.schema !== SCHEMA || !Array.isArray(search.channels) || search.channels.length !== channels)) {
    problems.push(`search.json: ${Array.isArray(search?.channels) ? search.channels.length : '?'} entradas, los países suman ${channels}`);
  }
  if (index.totals?.channels !== channels) problems.push(`index.json: totals.channels ${index.totals?.channels}, los países suman ${channels}`);
  if (channels < minChannels) problems.push(`solo ${channels} canales vivos (mínimo para publicar: ${minChannels})`);
  return { problems, summary: { generatedAt: index.generatedAt, countries: countries.length, channels, liveSources: index.totals?.liveSources } };
}
