const esbuild = require('esbuild');
const production = process.argv.includes('--production');
async function main() {
  // Extension host bundle (Node.js)
  await esbuild.build({
    entryPoints: ['./src/extension.ts'],
    bundle: true, outfile: './out/extension.js',
    external: ['vscode'], format: 'cjs', platform: 'node', target: 'node20',
    sourcemap: !production, minify: production,
  });
  // Webview bundle (browser, runs in VS Code webview)
  await esbuild.build({
    entryPoints: ['./src/webview/main.ts'],
    bundle: true, outfile: './webview/main.js',
    format: 'iife', platform: 'browser', target: 'es2022',
    sourcemap: !production, minify: production,
  });
  // Inject script bundle (served by proxy, runs in target pages)
  await esbuild.build({
    entryPoints: ['./src/webview/inject.ts'],
    bundle: true, outfile: './out/inject.js',
    format: 'iife', platform: 'browser', target: 'es2022',
    sourcemap: !production, minify: production,
  });
  console.log('Build complete');
}
main().catch((e) => { console.error(e); process.exit(1); });
