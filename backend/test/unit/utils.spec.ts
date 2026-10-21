import { detectFileType, resolveFileType } from '../../src/common/utils/file-type.util';
import { extensionOf, normalizePath, numberedName, pathHash } from '../../src/common/utils/path.util';
import { contentDisposition, parseRange } from '../../src/downloads/services/file-serving.service';
import { SignedUrlService } from '../../src/storage/signed-url.service';

describe('path utils', () => {
  it('normalizes slashes and rejects traversal', () => {
    expect(normalizePath('/a//b\\c.jpg/')).toBe('a/b/c.jpg');
    expect(() => normalizePath('a/../b')).toThrow();
    expect(() => normalizePath('a/./b')).toThrow();
    expect(() => normalizePath('')).toThrow();
    expect(() => normalizePath('a/\u0000b')).toThrow();
  });

  it('hashes per project', () => {
    expect(pathHash('p1', 'a.jpg')).not.toBe(pathHash('p2', 'a.jpg'));
    expect(pathHash('p1', 'a.jpg')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('numbers names before the extension', () => {
    expect(numberedName('photo.jpg', 2)).toBe('photo (2).jpg');
    expect(numberedName('README', 1)).toBe('README (1)');
    expect(extensionOf('archive.tar.GZ')).toBe('gz');
    expect(extensionOf('.env')).toBe('');
  });
});

describe('file type detection', () => {
  const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

  it('trusts bytes, not names', () => {
    expect(detectFileType(jpegHead)?.mime).toBe('image/jpeg');
    expect(resolveFileType('jpg', detectFileType(jpegHead))).toEqual({ mime: 'image/jpeg', isImage: true });
    expect(resolveFileType('jpg', detectFileType(Buffer.from('<!DOCTYPE html><p>x')))).toHaveProperty('error');
    expect(resolveFileType('png', detectFileType(Buffer.from('plain text')))).toHaveProperty('error');
    expect(resolveFileType('txt', detectFileType(Buffer.from('MZ\x90\x00')))).toHaveProperty('error');
  });

  it('maps office files by extension once the zip container matches', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(resolveFileType('xlsx', detectFileType(zip))).toEqual({
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isImage: false,
    });
  });

  it('recognises Rhino 3dm CAD files', () => {
    const head = Buffer.from('3D Geometry File Format        5');
    expect(resolveFileType('3dm', detectFileType(head))).toEqual({ mime: 'model/vnd.3dm', isImage: false });
  });
});

describe('http helpers', () => {
  it('parses single byte ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=200-300', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('builds RFC 6266 content-disposition', () => {
    expect(contentDisposition('attachment', 'résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });
});

describe('signed URLs', () => {
  const signer = new SignedUrlService(
    { urlSigningSecret: 'x'.repeat(40) } as never,
    { publicBaseUrl: 'https://s.example' } as never,
  );

  it('round-trips and rejects tampering, expiry and wrong purpose', () => {
    const url = signer.downloadUrl({ f: 'file', t: 'tenant' }, 60);
    const token = url.split('/d/')[1];
    expect(signer.verifyDownload(token)).toMatchObject({ f: 'file', t: 'tenant' });
    expect(signer.verifyUpload(token)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), t: 'other' })).toString('base64url');
    expect(signer.verifyDownload(`${forged}.${sig}`)).toBeNull();
    const expired = signer.downloadUrl({ f: 'file', t: 'tenant' }, -5).split('/d/')[1];
    expect(signer.verifyDownload(expired)).toBeNull();
  });
});
