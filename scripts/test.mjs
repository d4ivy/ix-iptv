#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `npm test`: ejecuta `node --test` con la lista explícita de `test/*.test.mjs`. Node 16 acepta una carpeta y Node 22+ espera
 * archivos o globs (y el shell de Windows no expande globs): así vale en los dos y en la Action.
 */
const files = readdirSync('test')
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join('test', name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
