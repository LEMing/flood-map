// Fail CI if any circular import is introduced (madge). Mirrors the convention
// used across the @ergeon repos. The graph is currently cycle-free; keep it so.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const out = execSync('npx madge --circular --extensions ts src/', { encoding: 'utf8', cwd: root, shell: true });
  process.stdout.write(out);
  console.log('✅ No circular dependencies.');
  process.exit(0);
} catch (error) {
  const output = (error.stdout || '') + (error.stderr || '');
  if (output.includes('circular')) {
    console.error('❌ Circular dependencies found:\n' + output);
    process.exit(1);
  }
  console.log('✅ No circular dependencies.');
  process.exit(0);
}
