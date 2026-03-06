import { useState } from 'react';
import { readFileAsDataUrl, getLastDraggedImageSrc, clearLastDraggedImageSrc } from './imageCapture';

export function useDragDrop(onImageCaptured: (dataUrl: string) => void) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const imageFile = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (imageFile) { onImageCaptured(await readFileAsDataUrl(imageFile)); return; }
    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
      if (img?.src?.startsWith('data:image')) { onImageCaptured(img.src); return; }
    }
    const src = getLastDraggedImageSrc();
    if (src) { onImageCaptured(src); clearLastDraggedImageSrc(); }
  };

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop };
}
