/**
 * File type detection from magic bytes. The filename, extension and the client's
 * Content-Type are hints only; what we store and serve is decided here.
 */

export const SNIFF_BYTES = 4100;

export interface Detection {
  mime: string;
  /** Broad family used to compare with what the extension claims. */
  family: 'image' | 'pdf' | 'zip' | 'cfb' | 'archive' | 'audio' | 'video' | 'cad' | 'executable' | 'markup' | 'text';
}

const ascii = (buf: Buffer, start: number, end: number) => buf.toString('latin1', start, end);
const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

export function detectFileType(head: Buffer): Detection | null {
  if (head.length === 0) return null;

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', family: 'image' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', family: 'image' };
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return { mime: 'image/gif', family: 'image' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { mime: 'image/webp', family: 'image' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return { mime: 'audio/wav', family: 'audio' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'AVI ') return { mime: 'video/x-msvideo', family: 'video' };
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', family: 'image' };
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', family: 'image' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', family: 'video' };
    if (brand.startsWith('M4A')) return { mime: 'audio/mp4', family: 'audio' };
    return { mime: 'video/mp4', family: 'video' };
  }
  if (ascii(head, 0, 2) === 'BM' && head.length > 14) return { mime: 'image/bmp', family: 'image' };
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mime: 'image/tiff', family: 'image' };
  }
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) return { mime: 'image/x-icon', family: 'image' };
  if (ascii(head, 0, 5) === '%PDF-') return { mime: 'application/pdf', family: 'pdf' };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    return { mime: 'application/zip', family: 'zip' };
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { mime: 'application/x-cfb', family: 'cfb' };
  }
  if (startsWith(head, [0x1f, 0x8b])) return { mime: 'application/gzip', family: 'archive' };
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { mime: 'application/x-7z-compressed', family: 'archive' };
  if (ascii(head, 0, 4) === 'Rar!') return { mime: 'application/vnd.rar', family: 'archive' };
  if (ascii(head, 0, 3) === 'ID3' || startsWith(head, [0xff, 0xfb])) return { mime: 'audio/mpeg', family: 'audio' };
  if (ascii(head, 0, 4) === 'OggS') return { mime: 'audio/ogg', family: 'audio' };
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'video/webm', family: 'video' };
  // Rhino 3D model (.3dm) - used for jewellery CAD files.
  if (ascii(head, 0, 24) === '3D Geometry File Format ') return { mime: 'model/vnd.3dm', family: 'cad' };
  if (ascii(head, 0, 2) === 'MZ') return { mime: 'application/x-msdownload', family: 'executable' };
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return { mime: 'application/x-elf', family: 'executable' };
  if (startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xcf])) {
    return { mime: 'application/x-mach-binary', family: 'executable' };
  }
  if (ascii(head, 0, 2) === '#!') return { mime: 'text/x-script', family: 'executable' };

  // Text-like content: look for markup that a browser would execute.
  const text = head.toString('utf8', 0, Math.min(head.length, 1024)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (/^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*<svg/.test(text) || text.startsWith('<svg')) {
    return { mime: 'image/svg+xml', family: 'markup' };
  }
  if (/^<(!doctype html|html|head|body|script|iframe|object)/.test(text)) return { mime: 'text/html', family: 'markup' };
  return null;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heic',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  '3dm': 'model/vnd.3dm',
  stl: 'model/stl',
  obj: 'model/obj',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  step: 'model/step',
  stp: 'model/step',
  dxf: 'image/vnd.dxf',
  dwg: 'image/vnd.dwg',
  sql: 'application/sql',
};

/** Which detected family each extension must match when we can detect it at all. */
const EXT_FAMILY: Record<string, Detection['family'][]> = {
  jpg: ['image'], jpeg: ['image'], jfif: ['image'], png: ['image'], gif: ['image'], webp: ['image'],
  avif: ['image'], heic: ['image'], heif: ['image'], bmp: ['image'], tif: ['image'], tiff: ['image'], ico: ['image'],
  svg: ['markup'],
  pdf: ['pdf'],
  zip: ['zip'], docx: ['zip'], xlsx: ['zip'], pptx: ['zip'], odt: ['zip'], ods: ['zip'], glb: [],
  doc: ['cfb'], xls: ['cfb'], ppt: ['cfb'],
  '3dm': ['cad'],
  mp3: ['audio'], wav: ['audio'], ogg: ['audio'], m4a: ['audio', 'video'],
  mp4: ['video'], m4v: ['video'], mov: ['video'], webm: ['video'], avi: ['video'],
  gz: ['archive'], tgz: ['archive'], '7z': ['archive'], rar: ['archive'],
};

/** Never accepted, whatever the project settings say. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'jar', 'sh', 'cpl', 'app', 'apk',
  'php', 'phtml', 'phar', 'asp', 'aspx', 'jsp', 'cgi', 'html', 'htm', 'xhtml', 'shtml', 'js', 'mjs',
]);

export const mimeFromExtension = (ext: string): string | undefined => EXT_MIME[ext];

export interface ResolvedType {
  mime: string;
  isImage: boolean;
}

/**
 * Decides the MIME type to store, or returns an error message when the content
 * contradicts the extension (e.g. an HTML page named photo.jpg).
 */
export function resolveFileType(ext: string, detected: Detection | null): ResolvedType | { error: string } {
  if (detected?.family === 'executable') return { error: 'Executable content is not allowed' };
  if (detected?.family === 'markup' && detected.mime === 'text/html') {
    return { error: 'HTML content is not allowed' };
  }

  const expected = EXT_FAMILY[ext];
  if (expected && expected.length > 0 && detected && !expected.includes(detected.family)) {
    return { error: `File content (${detected.mime}) does not match the .${ext} extension` };
  }
  if (expected?.includes('image') && !detected) {
    return { error: `File content is not a valid .${ext} image` };
  }
  if (expected?.includes('pdf') && !detected) return { error: 'File content is not a valid PDF' };

  // Prefer the precise extension mapping (docx vs plain zip) when it agrees with the content.
  const mime = (detected && detected.family !== 'zip' && detected.family !== 'cfb' ? detected.mime : undefined)
    ?? mimeFromExtension(ext)
    ?? detected?.mime
    ?? 'application/octet-stream';
  return { mime, isImage: isRasterImage(mime) };
}

const RASTER = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/tiff', 'image/heic']);
/** Images Sharp can turn into thumbnails/webp variants. */
export const isRasterImage = (mime: string): boolean => RASTER.has(mime);

const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp|avif|bmp|x-icon|tiff|heic|svg\+xml)|application\/pdf|video\/.+|audio\/.+|text\/plain|text\/csv)$/;
/** Everything else is sent as an attachment so a browser never renders it on our origin. */
export const isInlineSafe = (mime: string): boolean => INLINE_SAFE.test(mime);
