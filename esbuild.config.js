const pkg = require('./package.json');
const esbuild = require('esbuild');
const http = require('http');
const path = require('path');

const production = process.argv.includes('--production');
const watchMode = process.argv.includes('--watch');
const PORT = parseInt(process.env.PORT || '3000', 10);
const REBUILD_NOTIFY_DEBOUNCE_MS = 75;

let notifyTimer = null;
let suppressNotify = false;

function scheduleRebuildNotify(hasErrors) {
  if (hasErrors) {
    suppressNotify = true;
  }

  if (notifyTimer) {
    clearTimeout(notifyTimer);
  }

  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    if (!suppressNotify) {
      const req = http.request(
        { hostname: '127.0.0.1', port: PORT, path: '/internal/rebuilt', method: 'POST' },
        () => {}
      );
      req.on('error', () => {});
      req.end();
    }
    suppressNotify = false;
  }, REBUILD_NOTIFY_DEBOUNCE_MS);
}

function makeNotifyPlugin() {
  return {
    name: 'notify-standalone',
    setup(build) {
      build.onEnd((result) => {
        if (!watchMode) {
          return;
        }

        scheduleRebuildNotify(result.errors.length > 0);
      });
    },
  };
}

const loggingAliasPlugin = {
  name: 'alias-logging',
  setup(build) {
    build.onResolve({ filter: /[/\\]logging$/ }, () => ({
      path: path.resolve(__dirname, 'src/standalone/console-logger.ts'),
    }));
  },
};

async function main() {
  const shared = { sourcemap: !production, minify: production };

  const configs = [
    {
      entryPoints: ['./src/extension.ts'],
      bundle: true,
      outfile: './out/extension.js',
      external: ['vscode'],
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    {
      entryPoints: ['./src/webview/main.ts'],
      bundle: true,
      outfile: './webview/main.js',
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      define: {
        __EXTENSION_VERSION__: JSON.stringify(pkg.version),
      },
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    {
      entryPoints: ['./src/webview/inject.ts'],
      bundle: true,
      outfile: './out/inject.js',
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    {
      entryPoints: ['./src/standalone/vscode-shim.ts'],
      bundle: true,
      outfile: './out/standalone/vscode-shim.js',
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    {
      entryPoints: ['./src/standalone/server.ts'],
      bundle: true,
      outfile: './out/standalone/server.js',
      external: ['vscode'],
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      plugins: [loggingAliasPlugin],
      ...shared,
    },
  ];

  if (watchMode) {
    const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
    await Promise.all(contexts.map((context) => context.watch()));
    console.log('[esbuild] Watching for changes... (Ctrl+C to stop)');
  } else {
    await Promise.all(configs.map((config) => esbuild.build(config)));
    console.log('Build complete');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
