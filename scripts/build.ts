// Bundles the host with esbuild. esbuild and React are resolved from node_modules when installed,
// otherwise from the global tool folders available in the build workspace.
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const fallbacks = ['/opt/npm-tools/node_modules', join(process.env.HOME ?? '', '.npm-global/lib/node_modules')];
const req = createRequire(join(root, 'package.json'));
let esbuild: any;
for (const p of [undefined, ...fallbacks]) {
  try { esbuild = p ? createRequire(join(p, 'x.js'))('esbuild') : req('esbuild'); break; } catch { /* try next */ }
}
if (!esbuild) { console.error('esbuild not found. Run: npm install'); process.exit(1); }
const nodePaths = fallbacks.filter(existsSync);

const dist = join(root, 'host', 'dist');
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist, { recursive: true });
await esbuild.build({
  entryPoints: [join(root, 'host/src/main.tsx')], bundle: true, outfile: join(dist, 'app.js'), format: 'esm', target: 'es2022',
  jsx: 'automatic', minify: true, sourcemap: false, nodePaths, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info',
});
cpSync(join(root, 'host/public'), dist, { recursive: true });
console.log('Built host/dist');
