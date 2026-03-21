import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import { normalizeManifestPaths } from './scripts/manifest-path-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.BUILD === 'production';
const buildTarget = process.env.BUILD_TARGET === 'background' ? 'background' : 'content';
const shouldCopyStatic = process.env.COPY_STATIC !== 'false';
const emptyOutDir = process.env.EMPTY_OUT_DIR !== 'false';

const buildConfigPath = path.resolve(__dirname, '.buildconfig.json');
const buildConfig = JSON.parse(fs.readFileSync(buildConfigPath, 'utf-8'));

const aliases = {
  '@domain': path.resolve(__dirname, 'src/domain'),
  '@storage': path.resolve(__dirname, 'src/storage'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@utils': path.resolve(__dirname, 'src/utils'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@ui': path.resolve(__dirname, 'src/ui')
};

function getStaticCopyTargets() {
  if (!shouldCopyStatic) {
    return [];
  }

  return [
    {
      src: 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js',
      dest: '.'
    },
    {
      src: 'manifest.json',
      dest: '.',
      transform: content => normalizeManifestPaths(content.toString())
    },
    { src: 'popup.html', dest: '.' },
    { src: 'popup.js', dest: '.' },
    { src: 'options_page.html', dest: '.' },
    { src: 'options_page.js', dest: '.' },
    { src: 'state-manager.js', dest: '.' },
    { src: 'icons/**/*', dest: '.' },
    { src: 'sidebar/**/*', dest: '.' }
  ];
}

export default defineConfig({
  resolve: {
    alias: aliases
  },
  define: {
    'process.env.TEST_MODE': JSON.stringify(process.env.TEST_MODE || 'false'),
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development')
  },
  plugins: [
    viteStaticCopy({
      targets: getStaticCopyTargets()
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir,
    sourcemap: !production,
    minify: production ? 'esbuild' : false,
    lib: {
      entry:
        buildTarget === 'background'
          ? path.resolve(__dirname, 'background.js')
          : path.resolve(__dirname, 'src/content.js'),
      name: buildTarget === 'background' ? 'BackgroundScript' : 'ContentScript',
      formats: ['iife'],
      fileName: () => `${buildTarget}.js`
    },
    rollupOptions: {
      external: buildTarget === 'content' ? ['webextension-polyfill'] : [],
      output: {
        globals: {
          'webextension-polyfill': 'browser'
        }
      },
      treeshake: {
        moduleSideEffects: buildConfig.treeshake.moduleSideEffects,
        propertyReadSideEffects: buildConfig.treeshake.propertyReadSideEffects
      }
    }
  }
});
