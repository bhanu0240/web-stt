/**
 * Canonical transcript format: YAML front matter + body lines.
 * Each body line: [startMs-endMs] text, or [startMs-endMs] Label> text
 */

const LINE_RE =
  /^\[(?<start>\d+)-(?<end>\d+)\]\s*(?:(?<speaker>[^>\n]+)>\s*)?(?<text>.*)$/;

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
  raw: string;
};

export type ParsedTranscript = {
  frontmatter: Record<string, unknown>;
  body: string;
  segments: TranscriptSegment[];
};

export class TranscriptLineError extends Error {
  declare line: number;
  declare raw: string;

  constructor(message: string, line: number, raw: string) {
    super(message);
    this.name = 'TranscriptLineError';
    this.line = line;
    this.raw = raw;
  }
}

/** Parses full transcript markdown into front matter object and segment list. */
export function parseTranscriptMarkdown(markdown: string): ParsedTranscript {
  const trimmed = markdown.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    throw new Error('transcript.md must start with YAML front matter (---)');
  }
  const endFm = trimmed.indexOf('\n---', 3);
  if (endFm === -1) {
    throw new Error('Missing closing --- for front matter');
  }
  const fmRaw = trimmed.slice(3, endFm).trim();
  const body = trimmed.slice(endFm + 4).replace(/^\n+/, '');

  const frontmatter: Record<string, unknown> = {};
  for (const line of fmRaw.split('\n')) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val: unknown = m[2].trim();
    if (val === 'null' || val === '') val = null;
    else if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^\d+$/.test(String(val))) val = Number(val);
    else if (
      typeof val === 'string' &&
      val.startsWith('[') &&
      val.endsWith(']')
    ) {
      try {
        val = JSON.parse(val.replace(/'/g, '"')) as unknown;
      } catch {
        /* keep string */
      }
    }
    frontmatter[key] = val;
  }

  const lines = body.split('\n');
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const match = raw.match(LINE_RE);
    if (!match?.groups) {
      throw new TranscriptLineError(
        `Invalid transcript line ${i + 1}: expected [startMs-endMs] text`,
        i + 1,
        raw,
      );
    }
    const { start, end, speaker, text } = match.groups;
    segments.push({
      startMs: Number(start),
      endMs: Number(end),
      speaker: speaker?.trim() || null,
      text: text ?? '',
      raw,
    });
  }

  return { frontmatter, body, segments };
}

/** Serializes front matter (plain key: value YAML subset) and segment lines. */
export function serializeTranscriptMarkdown(
  frontmatter: Record<string, unknown>,
  segments: TranscriptSegment[],
): string {
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (v === undefined) continue;
    if (v === null) fmLines.push(`${k}: null`);
    else if (typeof v === 'string') {
      const needsQuote = /[:#\n]/.test(v) || v === '';
      fmLines.push(
        needsQuote ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`,
      );
    } else if (typeof v === 'boolean') fmLines.push(`${k}: ${v}`);
    else if (typeof v === 'number') fmLines.push(`${k}: ${v}`);
    else if (Array.isArray(v)) fmLines.push(`${k}: ${JSON.stringify(v)}`);
    else fmLines.push(`${k}: ${JSON.stringify(v)}`);
  }
  fmLines.push('---', '');
  const bodyLines = segments.map(formatSegmentLine);
  return `${fmLines.join('\n')}${bodyLines.join('\n')}${bodyLines.length ? '\n' : ''}`;
}

/** One transcript line from a segment record. */
export function formatSegmentLine(seg: TranscriptSegment): string {
  const { startMs, endMs, speaker, text } = seg;
  if (speaker) {
    return `[${startMs}-${endMs}] ${speaker}> ${text}`.trimEnd();
  }
  return `[${startMs}-${endMs}] ${text}`.trimEnd();
}

/** Merges partial front matter updates into existing object. */
export function patchFrontmatter(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    next[k] = v;
  }
  return next;
}
