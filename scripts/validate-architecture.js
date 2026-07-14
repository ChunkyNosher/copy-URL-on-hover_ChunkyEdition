import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

const rules = [
  {
    name: 'Domain layer has no feature dependencies',
    check: () => {
      const domainDir = path.join(srcDir, 'domain');
      if (!fs.existsSync(domainDir)) {
        return { pass: true, message: 'Domain layer not yet created' };
      }

      const domainFiles = getAllJsFiles(domainDir);
      for (const file of domainFiles) {
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
    name: 'Orphan storage adapter layer is not present',
    check: () => {
      const storageDir = path.join(srcDir, 'storage');
      if (!fs.existsSync(storageDir)) {
        return { pass: true, message: 'src/storage removed (canonical path is utils/storage-utils.js)' };
      }

      const storageFiles = getAllJsFiles(storageDir);
      if (storageFiles.length > 0) {
        return {
          pass: false,
          message: `src/storage still contains modules: ${storageFiles.map(f => path.basename(f)).join(', ')}`
        };
      }
      return { pass: true, message: 'src/storage directory empty' };
    }
  },

  {
    name: 'Quick Tabs facade exists',
    check: () => {
      const quickTabsIndex = path.join(srcDir, 'features/quick-tabs/index.js');
      if (!fs.existsSync(quickTabsIndex)) {
        return { pass: false, message: 'src/features/quick-tabs/index.js not found' };
      }
      return { pass: true };
    }
  },

  {
    name: 'Quick Tabs managers directory has expected modules',
    check: () => {
      const managersDir = path.join(srcDir, 'features/quick-tabs/managers');
      if (!fs.existsSync(managersDir)) {
        return { pass: true, message: 'Managers not yet created' };
      }

      // BroadcastManager and StorageManager were removed; StateManager + EventManager remain
      const requiredManagers = ['StateManager.js', 'EventManager.js'];
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

console.log('Validating architecture...\n');

let passed = 0;
let failed = 0;

for (const rule of rules) {
  const result = rule.check();
  if (!result.pass) {
    console.error(`FAIL ${rule.name}`);
    console.error(`   ${result.message}`);
    failed++;
    continue;
  }

  console.log(`PASS ${rule.name}`);
  if (result.message) {
    console.log(`   ${result.message}`);
  }
  passed++;
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error('Architecture validation failed. Please fix the issues above.');
  process.exit(1);
}

console.log('Architecture validation passed!');
