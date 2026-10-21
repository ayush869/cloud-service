import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  create(data: Prisma.RefreshTokenUncheckedCreateInput, tx?: Tx) {
    return (tx ?? this.prisma).refreshToken.create({ data });
  }

  /** Conditional revoke: returns false if someone else already used/revoked it (race or replay). */
  async revokeIfActive(id: string, tx: Tx): Promise<boolean> {
    const { count } = await tx.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, tx?: Tx) {
    return (tx ?? this.prisma).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  deleteExpired(before: Date) {
    return this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });
  }
}
