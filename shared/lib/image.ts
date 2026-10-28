/**
 * Menu photo upload (SRS 7 step 5): resize and compress to WebP, max ~200 KB, in the browser before upload.
 * In http mode the result is uploaded to S3-compatible storage by the API; in mock mode it is kept as a data URL.
 */
export async function compressImage(file: File, maxKB = 200, maxSide = 1200): Promise<string> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  let quality = 0.82;
  for (let i = 0; i < 8; i++) {
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/webp", quality);
    const kb = (url.length * 3) / 4 / 1024;
    if (kb <= maxKB) return url;
    if (quality > 0.5) quality -= 0.12;
    else scale *= 0.8;
  }
  return canvas.toDataURL("image/webp", 0.5);
}
