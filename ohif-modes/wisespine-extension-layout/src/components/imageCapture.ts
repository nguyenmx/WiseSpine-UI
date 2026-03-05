// Capture the src of any data-URL img being dragged (OHIF thumbnails)
let _lastDraggedImageSrc: string | null = null;
document.addEventListener('dragstart', e => {
  const el = e.target as HTMLElement;
  const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
  _lastDraggedImageSrc = img && img.src.startsWith('data:image') ? img.src : null;
});

export function getLastDraggedImageSrc(): string | null {
  return _lastDraggedImageSrc;
}

export function clearLastDraggedImageSrc(): void {
  _lastDraggedImageSrc = null;
}

export async function getViewportDataUrl(): Promise<string | null> {
  const allCanvases = Array.from(document.querySelectorAll('canvas')).filter(
    c => c.width > 0 && c.height > 0
  );
  if (allCanvases.length === 0) return null;

  // Find the largest canvas (main image layer)
  const largest = allCanvases.reduce((a, b) => a.width * a.height >= b.width * b.height ? a : b);
  const lr = largest.getBoundingClientRect();

  // Collect all canvases overlapping the largest (additional canvas layers if any)
  const layers = allCanvases.filter(c => {
    const r = c.getBoundingClientRect();
    return (
      Math.max(lr.left, r.left) < Math.min(lr.right, r.right) &&
      Math.max(lr.top, r.top) < Math.min(lr.bottom, r.bottom)
    );
  });
  layers.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  const offscreen = document.createElement('canvas');
  offscreen.width = largest.width;
  offscreen.height = largest.height;
  const ctx = offscreen.getContext('2d')!;

  // Draw canvas layers (image)
  for (const canvas of layers) {
    try { ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height); } catch { /* tainted */ }
  }

  // Cornerstone3D renders annotations (measurements, lines) as SVG overlays — composite those too
  const container = largest.closest('[class*="viewport"]') || largest.parentElement;
  const svgs = container
    ? Array.from(container.querySelectorAll('svg'))
    : Array.from(document.querySelectorAll('svg')).filter(svg => {
        const r = svg.getBoundingClientRect();
        return Math.max(lr.left, r.left) < Math.min(lr.right, r.right) &&
               Math.max(lr.top, r.top) < Math.min(lr.bottom, r.bottom);
      });

  for (const svg of svgs) {
    try {
      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      await new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height); URL.revokeObjectURL(url); resolve(); };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    } catch { /* skip */ }
  }

  return offscreen.toDataURL('image/jpeg', 0.85);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
