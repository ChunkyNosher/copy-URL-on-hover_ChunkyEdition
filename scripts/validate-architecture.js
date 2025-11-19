import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

const rules = [
  {
    name: 'Domain layer has no external dependencies',
    check: () => {
      const domainDir = path.join(srcDir, 'domain');
      if (!fs.existsSync(domainDir)) {
        return { pass: true, message: 'Domain layer not yet created' };
      }

      const domainFiles = getAllJsFiles(domainDir);
      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        // Check for imports from features or storage
        if (content.includes('@features/') || content.includes('../features/')) {
          return {
            pass: false,
            message: `${file} imports from features layer`
          };
        }
        if (content.includes('@storage/') || content.includes('../storage/')) {
          return {
            pass: false,
            message: `${file} imports from storage layer`
          };
        }
      }
      return { pass: true };
    }
  },

  {
    name: 'Storage layer does not depend on features',
    check: () => {
      const storageDir = path.join(srcDir, 'storage');
      if (!fs.existsSync(storageDir)) {
        return { pass: true, message: 'Storage layer not yet created' };
      }

      const storageFiles = getAllJsFiles(storageDir);
      for (const file of storageFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        if (content.includes('@features/') || content.includes('../features/')) {
          return {
            pass: false,
            message: `${file} imports from features layer`
          };
        }
      }
      return { pass: true };
    }
  },

  {
    name: 'Facades exist in correct location (when refactored)',
    check: () => {
      const quickTabsDir = path.join(srcDir, 'features/quick-tabs');

      // If the old index.js still exists, this is OK - we're in migration
      const oldIndexPath = path.join(quickTabsDir, 'index.js');
      if (fs.existsSync(oldIndexPath)) {
        return { pass: true, message: 'Old structure still in place (migration pending)' };
      }

      // If we're past migration, QuickTabsManager.js must exist
      const facadePath = path.join(quickTabsDir, 'QuickTabsManager.js');
      if (!fs.existsSync(facadePath)) {
        return { pass: false, message: 'QuickTabsManager facade not found after migration' };
      }
      return { pass: true };
    }
  },

  {
    name: 'All managers are in managers/ directory (when created)',
    check: () => {
      const managersDir = path.join(srcDir, 'features/quick-tabs/managers');
      if (!fs.existsSync(managersDir)) {
        return { pass: true, message: 'Managers not yet created' };
      }

      const requiredManagers = ['StorageManager.js', 'BroadcastManager.js', 'StateManager.js'];
      for (const manager of requiredManagers) {
        if (!fs.existsSync(path.join(managersDir, manager))) {
          return {
            pass: false,
            message: `${manager} not found in managers/`
          };
        }
      }
      return { pass: true };
    }
  }
];

function getAllJsFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (item.endsWith('.js') && !item.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Run validation
console.log('🔍 Validating architecture...\n');

let passed = 0;
let failed = 0;

for (const rule of rules) {
  const result = rule.check();
  if (!result.pass) {
    console.error(`❌ ${rule.name}`);
    console.error(`   ${result.message}`);
    failed++;
    continue;
  }

  console.log(`✅ ${rule.name}`);
  if (result.message) {
    console.log(`   ℹ️  ${result.message}`);
  }
  passed++;
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error('⚠️  Architecture validation failed. Please fix the issues above.');
  process.exit(1);
}

console.log('✅ Architecture validation passed!');
