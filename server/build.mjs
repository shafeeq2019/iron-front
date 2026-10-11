import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  packages: 'external',
  alias: { '@iron/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  // Bundle the shared simulation into the server output; keep npm deps external.
  plugins: [{ name: 'bundle-shared', setup(b) { b.onResolve({ filter: /^@iron\/shared$/ }, () => ({ path: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) })); } }],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
