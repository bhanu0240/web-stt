import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSegmentLine,
  parseTranscriptMarkdown,
  serializeTranscriptMarkdown,
  TranscriptLineError,
} from './transcript.js';

describe('transcript', () => {
  it('round-trips front matter and segment lines', () => {
    const md = `---
title: Test
status: ready
durationMs: 5000
---

[0-1000] Hello
[1000-2000] SPK> there
`;
    const parsed = parseTranscriptMarkdown(md);
    assert.equal(parsed.frontmatter.title, 'Test');
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[0].text, 'Hello');
    assert.equal(parsed.segments[1].speaker, 'SPK');
    const again = serializeTranscriptMarkdown(parsed.frontmatter, parsed.segments);
    const reparsed = parseTranscriptMarkdown(again);
    assert.equal(reparsed.segments.length, 2);
  });

  it('throws TranscriptLineError on bad cue line', () => {
    const bad = `---
title: X
---

not a valid line
`;
    assert.throws(
      () => parseTranscriptMarkdown(bad),
      (e: unknown) => e instanceof TranscriptLineError,
    );
  });

  it('formatSegmentLine omits speaker when null', () => {
    assert.equal(
      formatSegmentLine({
        startMs: 10,
        endMs: 20,
        speaker: null,
        text: 'ok',
        raw: '',
      }),
      '[10-20] ok',
    );
  });
});
