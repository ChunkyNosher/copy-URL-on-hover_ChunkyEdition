import alias from '@rollup/plugin-alias';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.BUILD === 'production';

// Load build configuration from .buildconfig.json
const buildConfigPath = path.resolve(__dirname, '.buildconfig.json');
const buildConfig = JSON.parse(fs.readFileSync(buildConfigPath, 'utf-8'));

// Rollup cache for faster rebuilds (especially in watch mode)
let cache;

// Module aliases for clean imports
const aliases = {
  '@domain': path.resolve(__dirname, 'src/domain'),
  '@storage': path.resolve(__dirname, 'src/storage'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@utils': path.resolve(__dirname, 'src/utils'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@ui': path.resolve(__dirname, 'src/ui')
};

/**
 * Get terser configuration based on build mode
 * Production: Aggressive minification with no beautification or comments
 * Development: Readable output with comments preserved
 */
function getTerserConfig() {
  const config = production ? buildConfig.terser.production : buildConfig.terser.development;
  return {
    compress: {
      drop_console: config.compress.drop_console,
      passes: config.compress.passes,
      dead_code: config.compress.dead_code ?? true,
      unused: config.compress.unused ?? true
    },
    mangle:
      config.mangle === false
        ? false
        : {
            properties: config.mangle?.properties ?? false,
            toplevel: config.mangle?.toplevel ?? false
          },
    format: {
      beautify: config.format.beautify,
      comments: config.format.comments,
      max_line_len: config.format.max_line_len,
      ...(config.format.indent_level && { indent_level: config.format.indent_level })
    }
  };
}

/**
 * Get tree-shaking configuration
 * Always enabled for consistency between dev and production
 * Uses 'recommended' preset with safe defaults
 */
function getTreeshakeConfig() {
  return {
    preset: buildConfig.treeshake.preset,
    moduleSideEffects: buildConfig.treeshake.moduleSideEffects,
    propertyReadSideEffects: buildConfig.treeshake.propertyReadSideEffects,
    tryCatchDeoptimization: buildConfig.treeshake.tryCatchDeoptimization
  };
}

// Common plugins for all bundles
const commonPlugins = [
  replace({
    preventAssignment: true,
    values: {
      'process.env.TEST_MODE': JSON.stringify(process.env.TEST_MODE || 'false'),
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development')
    }
  }),
  alias({ entries: aliases }),
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs(),
  // Apply terser in both dev and production, but with different configs
  terser(getTerserConfig())
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
    // Always enable tree-shaking for consistency
    treeshake: getTreeshakeConfig(),
    // Use cache for faster rebuilds
    cache
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
    // Always enable tree-shaking for consistency
    treeshake: getTreeshakeConfig(),
    // Use cache for faster rebuilds
    cache
  }
];
