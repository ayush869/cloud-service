import { Inject, Injectable } from '@nestjs/common';
import { appConfig, AppConfig, authConfig, AuthConfig } from '../config';
import { API_PREFIX } from '../common/constants';
import { hmacSha256, safeEqual } from '../common/utils/crypto.util';

export interface DownloadGrant {
  /** file id */
  f: string;
  /** tenant id */
  t: string;
  /** variant name, if any */
  v?: string;
  /** true = Content-Disposition: attachment */
  a?: boolean;
}

export interface UploadGrant {
  /** upload session id */
  u: string;
  t: string;
}

type Purpose = 'dl' | 'ul';

/**
 * Replaces S3 presigned URLs: a short-lived HMAC-signed token that names exactly one
 * file (or upload session) of one tenant. Tampering with any field breaks the signature.
 */
@Injectable()
export class SignedUrlService {
  constructor(
    @Inject(authConfig.KEY) private readonly auth: AuthConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  downloadUrl(grant: DownloadGrant, expiresInSeconds: number): string {
    return `${this.app.publicBaseUrl}/d/${this.sign('dl', grant, expiresInSeconds)}`;
  }

  uploadUrl(grant: UploadGrant, expiresInSeconds: number): string {
    const token = this.sign('ul', grant, expiresInSeconds);
    return `${this.app.publicBaseUrl}/${API_PREFIX}/uploads/${grant.u}/content?token=${token}`;
  }

  verifyDownload(token: string): DownloadGrant | null {
    return this.verify<DownloadGrant>('dl', token);
  }

  verifyUpload(token: string): UploadGrant | null {
    return this.verify<UploadGrant>('ul', token);
  }

  private sign(purpose: Purpose, grant: object, expiresInSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const body = Buffer.from(JSON.stringify({ ...grant, p: purpose, exp })).toString('base64url');
    const sig = hmacSha256(this.auth.urlSigningSecret, body).toString('base64url');
    return `${body}.${sig}`;
  }

  private verify<T>(purpose: Purpose, token: string): T | null {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = hmacSha256(this.auth.urlSigningSecret, body).toString('base64url');
    if (!safeEqual(sig, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.p !== purpose || typeof payload.exp !== 'number') return null;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload as T;
    } catch {
      return null;
    }
  }
}
