// ── 17b-fotos-compress.js — Foto-Kompression vor Speicherung ────────────────
// Ein Handy-Foto (3–5 MB, 4032×3024) wird auf max. 1024 px lange Kante
// verkleinert und als JPEG 75 % gespeichert. Ergebnis: ~150–250 KB.
//
// Public:
//   compressImage(file, opts)  → { blob, width, height, originalSize }
//   makeThumbnail(file, opts)  → { blob, width, height }   (160 px für Galerie)

const DEFAULTS = {
  maxEdge: 1024,   // px (lange Kante)
  quality: 0.75,   // JPEG-Qualität
  type:    'image/jpeg',
};

const THUMB_DEFAULTS = {
  maxEdge: 200,
  quality: 0.7,
  type:    'image/jpeg',
};

// ── Hauptfunktion: File → komprimierter Blob ────────────────────────────────
export async function compressImage(file, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (!file || !(file instanceof Blob)) {
    throw new Error('compressImage: kein Blob/File übergeben');
  }
  const originalSize = file.size;

  // ImageBitmap nutzt nativen Decoder (schnell + speicher-effizient)
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    throw new Error('Bild konnte nicht gelesen werden: ' + (e?.message || e));
  }

  const { width: ow, height: oh } = bitmap;
  const scale = Math.min(1, cfg.maxEdge / Math.max(ow, oh));
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('canvas.toBlob lieferte null')),
      cfg.type,
      cfg.quality,
    );
  });

  return { blob, width: w, height: h, originalSize, originalWidth: ow, originalHeight: oh };
}

// ── Thumbnail (kleinere Variante für Galerie) ───────────────────────────────
export async function makeThumbnail(file, opts = {}) {
  return compressImage(file, { ...THUMB_DEFAULTS, ...opts });
}

// ── Public: kompakte Größenangabe (Bytes → "1,2 MB" / "240 KB") ────────────
export function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}
