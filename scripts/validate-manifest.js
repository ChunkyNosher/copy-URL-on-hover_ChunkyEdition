#!/usr/bin/env node

/**
 * Validate Manifest for Packaging
 *
 * Ensures that the manifest.json in dist/ has correct paths for packaging.
 * This script is used in CI/CD to catch path issues before release.
 *
 * USAGE:
 * node scripts/validate-manifest.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'dist', 'manifest.json');

console.log('🔍 Validating manifest.json for packaging...');

try {
  // Check if manifest exists
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Error: dist/manifest.json not found!');
    console.error('   Run "npm run build:prod" first.');
    process.exit(1);
  }

  // Read and parse manifest
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  let hasErrors = false;

  // Check background scripts
  if (manifest.background && manifest.background.scripts) {
    manifest.background.scripts.forEach(script => {
      if (script.includes('dist/')) {
        console.error(`❌ Error: Background script has incorrect path: "${script}"`);
        console.error('   Path should be relative to manifest.json (remove "dist/" prefix)');
        hasErrors = true;
      } else {
        console.log(`  ✓ Background script: "${script}"`);
      }
    });
  }

  // Check content scripts
  if (manifest.content_scripts) {
    manifest.content_scripts.forEach((contentScript, index) => {
      if (contentScript.js) {
        contentScript.js.forEach(script => {
          if (script.includes('dist/')) {
            console.error(`❌ Error: Content script [${index}] has incorrect path: "${script}"`);
            console.error('   Path should be relative to manifest.json (remove "dist/" prefix)');
            hasErrors = true;
          } else {
            console.log(`  ✓ Content script [${index}]: "${script}"`);
          }
        });
      }
    });
  }

  if (hasErrors) {
    console.error('\n❌ Manifest validation failed!');
    console.error('   Run "npm run fix-manifest" to correct paths.');
    process.exit(1);
  }

  console.log('\n✅ Manifest validation passed!');
  console.log('   All script paths are correct for packaging.');
} catch (error) {
  console.error('❌ Error validating manifest:', error.message);
  process.exit(1);
}
