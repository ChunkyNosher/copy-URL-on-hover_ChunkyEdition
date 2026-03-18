import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const aliasEntries = {
  '@domain': path.resolve(__dirname, 'src/domain'),
  '@storage': path.resolve(__dirname, 'src/storage'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@utils': path.resolve(__dirname, 'src/utils'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@ui': path.resolve(__dirname, 'src/ui')
};

const staticCopyTargets = [
  { src: 'manifest.json', dest: '.' },
  { src: 'popup.html', dest: '.' },
  { src: 'popup.js', dest: '.' },
  { src: 'options_page.html', dest: '.' },
  { src: 'options_page.js', dest: '.' },
  { src: 'state-manager.js', dest: '.' },
  { src: 'icons/**', dest: 'icons' },
  { src: 'sidebar/**', dest: 'sidebar' },
  { src: 'updates.json', dest: '.' },
  {
    src: 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js',
    dest: '.'
  }
];

const isAnalyze = process.env.ANALYZE === 'true';
const bundleTarget = process.env.BUNDLE_TARGET || 'background';

const entryMap = {
  background: path.resolve(__dirname, 'background.js'),
  content: path.resolve(__dirname, 'src/content.js')
};

if (!entryMap[bundleTarget]) {
  throw new Error(`Unknown BUNDLE_TARGET "${bundleTarget}". Use "background" or "content".`);
}

export default defineConfig(({ mode }) => ({
  appType: 'custom',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : mode),
    'process.env.TEST_MODE': JSON.stringify(process.env.TEST_MODE ?? 'false')
  },
  resolve: {
    alias: aliasEntries
  },
  plugins: [
    ...(bundleTarget === 'background'
      ? [
          viteStaticCopy({
            targets: staticCopyTargets
          })
        ]
      : []),
    ...(isAnalyze && bundleTarget === 'background'
      ? [
          visualizer({
            filename: 'dist/bundle-stats.html',
            gzipSize: true,
            brotliSize: true
          })
        ]
      : [])
  ],
  build: {
    emptyOutDir: bundleTarget === 'background',
    outDir: 'dist',
    sourcemap: mode !== 'production',
    minify: mode === 'production' ? 'terser' : false,
    target: 'es2020',
    rollupOptions: {
      input: {
        [bundleTarget]: entryMap[bundleTarget]
      },
      external: ['webextension-polyfill'],
      output: {
        format: 'iife',
        name: bundleTarget === 'background' ? 'BackgroundScript' : 'ContentScript',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        inlineDynamicImports: false,
        globals: {
          'webextension-polyfill': 'browser'
        }
      }
    }
  }
}));
