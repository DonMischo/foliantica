import type { CSSProperties } from "react";

/** Crop rectangle in original-image pixel coordinates (react-easy-crop's croppedAreaPixels shape). */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Style for an <img> so that the cropped (square) region cover-fills a
 * `width` x `height` container, centered. Must be placed inside a container
 * of that exact size with `overflow: hidden` (and `border-radius` for a
 * circular frame). `width`/`height` may differ from the crop's own aspect
 * (e.g. a portrait-shaped thumbnail showing a square crop) — the crop is
 * centered and the longer container dimension is filled.
 */
export function cropImageStyle(crop: ImageCrop, width: number, height = width): CSSProperties {
  const scale = Math.max(width, height) / crop.width;
  const tx = -crop.x + (width - crop.width * scale) / (2 * scale);
  const ty = -crop.y + (height - crop.height * scale) / (2 * scale);
  return {
    position: "absolute",
    top: 0,
    left: 0,
    maxWidth: "none",
    transformOrigin: "0 0",
    transform: `scale(${scale}) translate(${tx}px, ${ty}px)`,
  };
}
