/**
 * Writes the bundled tenants out as served documents.
 *
 * They are generated rather than hand-written so the fallback baked into the
 * bundle and the document fetched at runtime cannot drift apart silently.
 * Run with: node scripts/emit-tenants.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'tenants');

// The tenants are TypeScript; read them through a tiny transform rather than
// adding a build step for one script.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { readFileSync } = require('node:fs');

const source = readFileSync(join(here, '..', 'src', 'theme', 'tenants.ts'), 'utf8');
const js = ts.transpileModule(source.replace(/import type[^;]+;/g, ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const module_ = { exports: {} };
new Function('module', 'exports', js)(module_, module_.exports);

mkdirSync(outDir, { recursive: true });

for (const [id, tenant] of Object.entries(module_.exports.TENANTS)) {
  writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(tenant, null, 2)}\n`);
  console.log(`wrote public/tenants/${id}.json`);
}
