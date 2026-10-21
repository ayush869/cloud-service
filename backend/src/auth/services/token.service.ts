import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { authConfig, AuthConfig } from '../../config';
import { ClientMeta } from '../../common/decorators';
import { Errors } from '../../common/exceptions/app.exception';
import { randomToken, sha256Hex } from '../../common/utils/crypto.util';
import { PrismaService, Tx } from '../../database/prisma.service';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';

/** Only identifiers - roles/permissions are looked up per request so revocations apply quickly. */
export interface AccessTokenPayload {
  sub: string;
  tid: string;
  typ: 'access';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly prisma: PrismaService,
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
  ) {}

  async verifyAccess(token: string): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
      return payload.typ === 'access' && payload.sub && payload.tid ? payload : null;
    } catch {
      return null;
    }
  }

  /** New access token + a refresh token starting (or continuing) a rotation family. */
  async issue(user: { id: string; tenantId: string }, meta: ClientMeta, familyId: string = randomUUID(), tx?: Tx): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, tid: user.tenantId, typ: 'access' } satisfies AccessTokenPayload);
    const refreshToken = randomToken(48);
    await this.refreshTokens.create(
      {
        tenantId: user.tenantId,
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + this.config.refreshExpiresDays * 86_400_000),
        ipAddress: meta.ipAddress.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 255),
      },
      tx,
    );
    const decoded = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: decoded.exp - decoded.iat };
  }

  /**
   * Rotation with reuse detection: every refresh token works once. Presenting one that
   * was already rotated means it leaked, so the whole family (all its descendants) dies.
   */
  async rotate(refreshToken: string, meta: ClientMeta): Promise<{ userId: string; tenantId: string; tokens: IssuedTokens }> {
    const row = await this.refreshTokens.findByHash(sha256Hex(refreshToken));
    if (!row) throw Errors.unauthorized('Invalid refresh token');
    if (row.revokedAt) {
      await this.refreshTokens.revokeFamily(row.familyId);
      throw Errors.unauthorized('Refresh token has already been used');
    }
    if (row.expiresAt < new Date()) throw Errors.unauthorized('Refresh token has expired');

    const tokens = await this.prisma.$transaction(async (tx) => {
      if (!(await this.refreshTokens.revokeIfActive(row.id, tx))) {
        throw Errors.unauthorized('Refresh token has already been used');
      }
      return this.issue({ id: row.userId, tenantId: row.tenantId }, meta, row.familyId, tx);
    });
    return { userId: row.userId, tenantId: row.tenantId, tokens };
  }

  /** Logout: kills the presented token's whole family (this device's session). */
  async revoke(refreshToken: string): Promise<{ userId: string; tenantId: string } | null> {
    const row = await this.refreshTokens.findByHash(sha256Hex(refreshToken));
    if (!row) return null;
    await this.refreshTokens.revokeFamily(row.familyId);
    return { userId: row.userId, tenantId: row.tenantId };
  }

  revokeAllForUser(userId: string, tx?: Tx) {
    return this.refreshTokens.revokeAllForUser(userId, tx);
  }
}
