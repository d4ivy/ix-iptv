#!/usr/bin/env node
import { verifyOutput } from '../src/verify.mjs';

/** `node scripts/verify.mjs --dir <dir> [--min-channels <n>]`: comprueba la salida antes de publicarla (código de salida 1 si falla). */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const dir = arg('dir', 'data');
const minChannels = Number(arg('min-channels', '1'));
const { problems, summary } = await verifyOutput(dir, { minChannels });
if (summary !== null) console.log(`${dir}: ${summary.channels} canales vivos en ${summary.countries} países (${summary.liveSources} URL), generado ${summary.generatedAt}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exitCode = 1;
} else {
  console.log('✔ salida válida para publicar');
}
