import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomToken } from '../../common/utils/crypto.util';

/** Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations). */
@Injectable()
export class PasswordService {
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burns comparable time when the user does not exist, so login timing doesn't reveal accounts. */
  async dummyVerify(): Promise<void> {
    this.dummyHash ??= this.hash(randomToken());
    await this.verify(await this.dummyHash, 'not-the-password');
  }
}
