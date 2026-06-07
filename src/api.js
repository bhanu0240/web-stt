/**
 * Thin fetch wrappers for the Express library API (paths proxied via Vite in dev).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function parseJson(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** GET /api/health */
export function getHealth() {
  return fetch('/api/health').then(parseJson);
}

/** GET /api/hf/models — curated ASR + embedding models for the UI */
export function getHfModels() {
  return fetch('/api/hf/models').then(parseJson);
}

/** GET /api/assets */
export function listAssets() {
  return fetch('/api/assets').then(parseJson);
}

/** POST /api/assets — multipart upload */
export function uploadAssets(files, languageHint) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (languageHint) fd.append('languageHint', languageHint);
  return fetch('/api/assets', { method: 'POST', body: fd }).then(parseJson);
}

/** GET /api/assets/:id */
export function getAsset(id) {
  return fetch(`/api/assets/${encodeURIComponent(id)}`).then(parseJson);
}

/** PATCH /api/assets/:id — metadata */
export function patchAssetMeta(id, body) {
  return fetch(`/api/assets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  }).then(parseJson);
}

/** PATCH /api/assets/:id/transcript */
export function patchTranscript(id, segments) {
  return fetch(`/api/assets/${encodeURIComponent(id)}/transcript`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ segments }),
  }).then(parseJson);
}

/** POST transcribe job (async on server) */
export function postTranscribe(id, strategies) {
  return fetch(`/api/assets/${encodeURIComponent(id)}/jobs/transcribe`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(strategies ? { strategies } : {}),
  }).then(parseJson);
}

/** GET transcription runs */
export function getRuns(id) {
  return fetch(
    `/api/assets/${encodeURIComponent(id)}/transcription-runs`,
  ).then(parseJson);
}

/** POST promote run */
export function promoteRun(assetId, slug) {
  return fetch(
    `/api/assets/${encodeURIComponent(assetId)}/transcription-runs/${encodeURIComponent(slug)}/promote`,
    { method: 'POST' },
  ).then(parseJson);
}

/** GET library search */
export function librarySearch(q, semantic) {
  const sp = new URLSearchParams({ q });
  if (semantic) sp.set('semantic', 'true');
  return fetch(`/api/library/search?${sp}`).then(parseJson);
}

/** POST reindex (embed chunks) */
export function postReindex(id) {
  return fetch(`/api/assets/${encodeURIComponent(id)}/jobs/reindex`, {
    method: 'POST',
  }).then(parseJson);
}

/** POST export clip */
export function postExport(id, startMs, endMs, format) {
  return fetch(`/api/assets/${encodeURIComponent(id)}/export`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ startMs, endMs, format }),
  }).then(parseJson);
}
