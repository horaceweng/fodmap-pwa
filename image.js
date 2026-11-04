const MAX_EDGE = 1568;

async function loadSource(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close && bmp.close() };
  } catch (_) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export async function prepareImage(file) {
  const s = await loadSource(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(s.w, s.h));
  const w = Math.max(1, Math.round(s.w * scale));
  const h = Math.max(1, Math.round(s.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // JPEG 無透明度
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(s.src, 0, 0, w, h);
  s.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mediaType: "image/jpeg",
    previewUrl: dataUrl,
  };
}
