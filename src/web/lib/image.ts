/**
 * Prepares a photo for upload: fixes phone camera rotation, shrinks it to at most ~1000 px and compresses it
 * (WebP, or JPEG where WebP isn't available) to well under the 400 KB server limit. A typical phone photo of
 * several MB becomes 50-150 KB, which keeps uploads fast on slow connections and storage free.
 */
const MAX_UPLOAD_BYTES = 350_000;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareProductPhoto(file: File): Promise<Blob> {
  const looksLikeImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name);
  if (!looksLikeImage) throw new Error("Please choose a photo (JPG, PNG or WebP).");
  if (file.size > 30 * 1024 * 1024) throw new Error("That photo is too large (over 30 MB).");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo format can't be opened here. Please use a JPG or PNG photo.");
  }
  try {
    for (const maxSide of [1000, 800, 600]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser couldn't process this photo.");
      ctx.fillStyle = "#ffffff"; // transparent areas become white instead of black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.82, 0.7, 0.6]) {
        let blob = await toBlob(canvas, "image/webp", quality);
        if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Couldn't make this photo small enough to upload. Try a different photo.");
}
