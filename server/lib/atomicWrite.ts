import fs from 'node:fs/promises';
import path from 'node:path';

/** Writes UTF-8 text to `targetPath` via temp file + rename for atomicity. */
export async function atomicWriteText(
  targetPath: string,
  text: string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, targetPath);
}
