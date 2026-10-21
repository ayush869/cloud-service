import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Tenant, User } from '@prisma/client';
import { appConfig, AppConfig, authConfig, AuthConfig, storageConfig, StorageConfig } from '../../config';
import { CacheKeys, ROLE_PERMISSIONS } from '../../common/constants';
import { ClientMeta } from '../../common/decorators';
import { AppException, Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { randomToken, sha256Hex } from '../../common/utils/crypto.util';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import { isUniqueViolation, PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CacheService } from '../../redis/cache.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { UsersRepository } from '../../users/repositories/users.repository';
import { PasswordService } from '../../users/services/password.service';
import { toUserDto } from '../../users/services/users.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from '../dto/auth.dto';
import { PasswordResetsRepository } from '../repositories/password-resets.repository';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly tenants: TenantsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly resets: PasswordResetsRepository,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @Inject(authConfig.KEY) private readonly authCfg: AuthConfig,
    @Inject(storageConfig.KEY) private readonly storageCfg: StorageConfig,
  ) {}

  /** Creates a tenant with its first OWNER user. Also used by the CLI on closed deployments. */
  async register(dto: RegisterDto, meta: ClientMeta, opts: { bypassToggle?: boolean } = {}) {
    if (!this.app.registrationEnabled && !opts.bypassToggle) {
      throw Errors.forbidden('Registration is disabled on this server', 'REGISTRATION_DISABLED');
    }
    const email = dto.email.toLowerCase().trim();
    if (await this.users.findByEmail(email)) {
      throw Errors.conflict('EMAIL_TAKEN', 'An account with this e-mail already exists');
    }
    const slug = dto.tenantSlug ?? (await uniqueSlug(slugify(dto.tenantName), (s) => this.tenants.slugExists(s)));
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const { tenant, user, tokens } = await this.prisma.$transaction(async (tx) => {
        const tenant = await this.tenants.create(
          { name: dto.tenantName.trim(), slug, storageLimitBytes: BigInt(this.storageCfg.defaultTenantLimitBytes) },
          tx,
        );
        const user = await this.users.create(
          { tenantId: tenant.id, name: dto.name.trim(), email, passwordHash, role: 'OWNER', lastLoginAt: new Date() },
          tx,
        );
        const tokens = await this.tokens.issue(user, meta, undefined, tx);
        return { tenant, user, tokens };
      });
      await this.audit.log(this.contextFor(user, meta), { action: 'REGISTER', resourceType: 'TENANT', resourceId: tenant.id });
      return this.session(user, tenant, tokens);
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('TENANT_OR_EMAIL_TAKEN', 'Tenant slug or e-mail is already in use');
      throw e;
    }
  }

  async login(dto: LoginDto, meta: ClientMeta) {
    const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
    if (!user) {
      await this.passwords.dummyVerify();
      throw this.invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      await this.audit.log(this.contextFor(user, meta), { action: 'LOGIN_FAILED', resourceType: 'AUTH', resourceId: user.id });
      throw this.invalidCredentials();
    }
    if (user.status !== 'ACTIVE') throw Errors.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
    if (user.tenant.status !== 'ACTIVE') throw Errors.forbidden('This tenant is suspended', 'TENANT_SUSPENDED');

    const tokens = await this.tokens.issue(user, meta);
    await this.users.touchLastLogin(user.id);
    await this.audit.log(this.contextFor(user, meta), { action: 'LOGIN', resourceType: 'AUTH', resourceId: user.id });
    return this.session(user, user.tenant, tokens);
  }

  async refresh(refreshToken: string, meta: ClientMeta) {
    const { userId, tenantId, tokens } = await this.tokens.rotate(refreshToken, meta);
    const user = await this.users.findByIdAndTenant(userId, tenantId);
    const tenant = await this.tenants.findById(tenantId);
    if (!user || user.status !== 'ACTIVE' || !tenant || tenant.status !== 'ACTIVE') {
      await this.tokens.revokeAllForUser(userId);
      throw Errors.unauthorized('Account is no longer active');
    }
    return tokens;
  }

  async logout(refreshToken: string, meta: ClientMeta) {
    const owner = await this.tokens.revoke(refreshToken);
    if (owner) {
      await this.audit.log(
        { ...this.contextFor({ id: owner.userId, tenantId: owner.tenantId, role: 'VIEWER' }, meta) },
        { action: 'LOGOUT', resourceType: 'AUTH', resourceId: owner.userId },
      );
    }
    return { loggedOut: true };
  }

  /** Always answers the same way so it cannot be used to discover accounts. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
    if (user && user.status === 'ACTIVE') {
      const token = randomToken(32);
      await this.resets.create(user.id, sha256Hex(token), new Date(Date.now() + this.authCfg.passwordResetExpiresMinutes * 60_000));
      // TODO(mail): deliver via an e-mail provider. Until then the token is only logged outside production.
      if (!this.app.isProduction) this.logger.warn(`Password reset token for ${user.email}: ${token}`);
    }
    return { message: 'If the account exists, password reset instructions have been sent' };
  }

  async resetPassword(dto: ResetPasswordDto, meta: ClientMeta) {
    const reset = await this.resets.findValid(sha256Hex(dto.token));
    if (!reset) throw Errors.badRequest('INVALID_RESET_TOKEN', 'The reset link is invalid or has expired');
    const passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.resets.markUsed(reset.id, tx))) {
        throw Errors.badRequest('INVALID_RESET_TOKEN', 'The reset link is invalid or has expired');
      }
      await this.users.setPasswordHash(reset.userId, passwordHash, tx);
      // Sign out every session: whoever forced the reset may be the one holding them.
      await this.tokens.revokeAllForUser(reset.userId, tx);
    });
    await this.cache.del(CacheKeys.user(reset.userId));
    await this.audit.log(this.contextFor(reset.user, meta), { action: 'PASSWORD_RESET', resourceType: 'AUTH', resourceId: reset.userId });
    return { reset: true };
  }

  private session(user: User, tenant: Tenant, tokens: Awaited<ReturnType<TokenService['issue']>>) {
    return {
      ...tokens,
      user: toUserDto(user),
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  private invalidCredentials() {
    return new AppException('INVALID_CREDENTIALS', 'Invalid e-mail or password', HttpStatus.UNAUTHORIZED);
  }

  private contextFor(user: Pick<User, 'id' | 'tenantId' | 'role'>, meta: ClientMeta): AuthContext {
    return {
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
      authType: 'JWT',
      permissions: new Set(ROLE_PERMISSIONS[user.role]),
      ...meta,
    };
  }
}
