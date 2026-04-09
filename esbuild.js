const esbuild = require('esbuild');

const production = process.argv.includes('--production');

esbuild
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    external: ['vscode'],
    outdir: 'out',
    platform: 'node',
    target: 'node18',
  })
  .catch(() => process.exit(1));
