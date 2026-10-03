// The Camera section's preview: one request at a time (a still camera takes seconds per photo, and
// overlapping requests piled up), the last good photo kept on screen, and the engine's reason shown
// when it can't take one.

export interface PreviewUpdate {
  photo: Blob | null; // null: keep showing the last one
  note: string; // why there's no new photo; "" when there is
}

export async function previewStep(fetchPreview: () => Promise<Response>): Promise<PreviewUpdate> {
  try {
    const r = await fetchPreview();
    if (r.ok) return { photo: await r.blob(), note: "" };
    const body = (await r.json().catch(() => ({}))) as { detail?: string };
    return { photo: null, note: body.detail ?? `The camera preview failed (${r.status}).` };
  } catch {
    return { photo: null, note: "Can't reach the engine. Is make dev running?" };
  }
}
