/**
 * Shared bridge between WiseSpineLayoutComponent (which has OHIF service access)
 * and ChatController (which is isolated from OHIF services).
 *
 * The layout component calls setViewportMeta() when the active viewport changes.
 * ChatController calls getViewportMeta() when building a message to send.
 */

export interface ViewportMeta {
  patientName?: string;
  patientAge?: string;
  patientSex?: string;
  modality?: string;
  bodyPartExamined?: string;
  studyDescription?: string;
  seriesDescription?: string;
  studyDate?: string;
}

let _current: ViewportMeta = {};

export function setViewportMeta(meta: ViewportMeta): void {
  _current = meta;
}

export function getViewportMeta(): ViewportMeta {
  return _current;
}

/** Returns a compact text string to inject into the system prompt, or '' if no metadata. */
export function formatViewportMeta(meta: ViewportMeta): string {
  const parts: string[] = [];
  const patient = [meta.patientAge, meta.patientSex].filter(Boolean).join(', ');
  if (patient) parts.push(`Patient: ${patient}`);
  if (meta.modality) parts.push(`Modality: ${meta.modality}`);
  if (meta.bodyPartExamined) parts.push(`Body Part: ${meta.bodyPartExamined}`);
  if (meta.studyDescription) parts.push(`Study: ${meta.studyDescription}`);
  if (meta.seriesDescription) parts.push(`Series: ${meta.seriesDescription}`);
  if (meta.studyDate) parts.push(`Date: ${meta.studyDate}`);
  return parts.length > 0 ? `\n\nCurrent DICOM context: ${parts.join(' | ')}` : '';
}
