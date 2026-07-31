import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['dist', 'release', 'test-results']) {
  await fs.rm(path.join(ROOT, dir), { recursive: true, force: true });
  console.log(`제거: ${dir}/`);
}
