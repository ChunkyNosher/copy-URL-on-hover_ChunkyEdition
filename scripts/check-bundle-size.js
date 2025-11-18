import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_BUNDLE_SIZES = {
  'content.js': 500 * 1024, // 500KB max
  'background.js': 300 * 1024, // 300KB max
  'popup.js': 100 * 1024 // 100KB max
};

let failed = false;

for (const [file, maxSize] of Object.entries(MAX_BUNDLE_SIZES)) {
  const filePath = path.join(__dirname, '..', 'dist', file);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${file}: not found (skipping)`);
    continue;
  }

  const stats = fs.statSync(filePath);
  const sizeMB = (stats.size / 1024).toFixed(2);
  const maxMB = (maxSize / 1024).toFixed(2);

  if (stats.size > maxSize) {
    console.error(`❌ ${file}: ${sizeMB}KB exceeds limit of ${maxMB}KB`);
    failed = true;
  } else {
    console.log(`✅ ${file}: ${sizeMB}KB (limit: ${maxMB}KB)`);
  }
}

if (failed) {
  console.error('\n⚠️  Bundle size check failed. Consider code splitting or tree-shaking.');
  process.exit(1);
}

console.log('\n✅ All bundle sizes within limits.');
