/**
 * Resolves which image to attach to the outgoing message.
 * If the user explicitly dragged/uploaded an image (previewDataUrl), use that.
 * Otherwise auto-capture the active DICOM viewport canvas.
 * Returns null values if the selected model does not support images.
 */

import { getViewportDataUrl } from './imageCapture';

export interface ResolvedImage {
  imageDataUrl: string | null;
  imageBase64: string | null;
  mimeType: string;
}

export async function resolveMessageImage(
  supportsImages: boolean,
  previewDataUrl: string | null
): Promise<ResolvedImage> {
  if (!supportsImages) return { imageDataUrl: null, imageBase64: null, mimeType: 'image/jpeg' };

  let imageDataUrl: string | null = null;
  let mimeType = 'image/jpeg';

  if (previewDataUrl) {
    imageDataUrl = previewDataUrl;
    const match = previewDataUrl.match(/^data:(image\/\w+);base64,/);
    if (match) mimeType = match[1];
  } else {
    imageDataUrl = await getViewportDataUrl();
  }

  const imageBase64 = imageDataUrl ? imageDataUrl.split(',')[1] : null;
  return { imageDataUrl, imageBase64, mimeType };
}
