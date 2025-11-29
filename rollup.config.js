import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import path from 'path';
import { fileURLToPath } from 'url';
import replace from '@rollup/plugin-replace';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.BUILD === 'production';

// Module aliases for clean imports
const aliases = {
  '@domain': path.resolve(__dirname, 'src/domain'),
  '@storage': path.resolve(__dirname, 'src/storage'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@utils': path.resolve(__dirname, 'src/utils'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@ui': path.resolve(__dirname, 'src/ui')
};

// Common plugins for all bundles
const commonPlugins = [
  replace({
    preventAssignment: true,
    values: {
      'process.env.TEST_MODE': JSON.stringify(process.env.TEST_MODE || 'false'),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }
  }),
  alias({ entries: aliases }),
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs(),
  production &&
    terser({
      compress: {
        drop_console: false, // Keep console for extension debugging
        passes: 2
      },
      mangle: {
        properties: false // Don't mangle browser API properties
      },
      format: {
        beautify: true, // Format code for readability
        indent_level: 2, // Use 2-space indentation
        comments: 'some', // Keep some comments
        max_line_len: 120 // Reasonable line length
      }
    })
];

export default [
  // Content script bundle
  {
    input: 'src/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      name: 'ContentScript',
      sourcemap: !production,
      globals: {
        'webextension-polyfill': 'browser'
      }
    },
    external: ['webextension-polyfill'],
    plugins: commonPlugins,
    treeshake: production
  },
  // Background script bundle
  {
    input: 'background.js',
    output: {
      file: 'dist/background.js',
      format: 'iife',
      name: 'BackgroundScript',
      sourcemap: !production
    },
    plugins: commonPlugins,
    treeshake: production
  }
];
