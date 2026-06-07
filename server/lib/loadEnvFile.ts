import fs from 'node:fs';

/**
 * Parses a minimal dotenv file into process.env. Does not expand variable substitution.
 * @param override When true, replaces existing process.env entries for keys in the file.
 */
export function loadEnvFile(filePath: string, override: boolean): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
