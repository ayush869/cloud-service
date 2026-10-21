import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../database/prisma.service';

@Injectable()
export class PasswordResetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findValid(tokenHash: string) {
    return this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
  }

  async markUsed(id: string, tx: Tx): Promise<boolean> {
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
}
