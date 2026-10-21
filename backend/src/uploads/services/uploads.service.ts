import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { File, Visibility } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { storageConfig, StorageConfig } from '../../config';
import { AppException, Errors } from '../../common/exceptions/app.exception';
import { actorOf, ProjectContext } from '../../common/types';
import { BLOCKED_EXTENSIONS, detectFileType, isRasterImage, resolveFileType } from '../../common/utils/file-type.util';
import {
  extensionOf,
  joinPath,
  normalizeFolderPath,
  normalizeName,
  normalizePath,
  pathHash,
  splitPath,
} from '../../common/utils/path.util';
import { isUniqueViolation, PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FilePresenter } from '../../files/services/file-presenter.service';
import { FilesService } from '../../files/services/files.service';
import { FilesRepository } from '../../files/repositories/files.repository';
import { FoldersService } from '../../folders/services/folders.service';
import { JobsService } from '../../jobs/jobs.service';
import { ProjectSettings, ProjectsService } from '../../projects/services/projects.service';
import { QuotaService } from '../../quotas/quota.service';
import { SignedUrlService } from '../../storage/signed-url.service';
import { ObjectTooLargeError, StorageService, WrittenObject } from '../../storage/storage.service';
import { ConflictStrategy, PresignUploadDto } from '../dto/upload.dto';
import { UploadSessionsRepository } from '../repositories/upload-sessions.repository';

/** Completion is accepted this long after the upload URL expired (client finished just in time). */
const COMPLETE_GRACE_MS = 15 * 60_000;

export interface IngestOptions {
  /** Full path including file name. */
  path?: string;
  /** Or: name + folderId/folderPath. */
  name?: string;
  folderId?: string | null;
  folderPath?: string;
  declaredSize?: number;
  visibility?: Visibility;
  onConflict: ConflictStrategy;
}

interface Target {
  folderId: string | null;
  dir: string;
  name: string;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UploadSessionsRepository,
    private readonly files: FilesRepository,
    private readonly filesService: FilesService,
    private readonly folders: FoldersService,
    private readonly projects: ProjectsService,
    private readonly storage: StorageService,
    private readonly signer: SignedUrlService,
    private readonly quota: QuotaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly presenter: FilePresenter,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {}

  // ─── Direct upload: the request body streams straight to disk ─────────────────────────

  /**
   * Used by multipart POST /files/upload and PUT /objects. Bytes are hashed, size-limited
   * and type-checked while streaming; the database is only touched once they are on disk.
   */
  async ingest(ctx: ProjectContext, source: Readable, opts: IngestOptions) {
    const settings = await this.projects.settingsFor(ctx.tenantId, ctx.projectId);
    let target = await this.resolveTarget(ctx, opts);
    const ext = extensionOf(target.name);
    this.assertExtensionAllowed(ext, settings);
    const maxBytes = this.maxBytes(settings);
    if (opts.declaredSize !== undefined) {
      if (opts.declaredSize > maxBytes) throw Errors.fileTooLarge(maxBytes);
      await this.quota.assertCanStore(ctx.tenantId, opts.declaredSize);
    }

    // Decide what happens at the destination path before accepting any bytes.
    let existing = await this.occupant(ctx, joinPath(target.dir, target.name));
    if (existing) {
      if (existing.status === 'PENDING') throw Errors.conflict('UPLOAD_IN_PROGRESS', 'Another upload to this path is in progress');
      if (opts.onConflict === 'error') throw this.exists(existing.path);
      if (opts.onConflict === 'rename') {
        target = { ...target, name: await this.filesService.freeName(ctx, target.dir, target.name) };
        existing = null;
      }
    }

    const objectId = randomUUID();
    const key = this.storage.objectKey(ctx.tenantId, objectId);
    const written = await this.writeOrThrow(key, source, maxBytes);
    let committed = false;
    try {
      const type = resolveFileType(ext, detectFileType(written.head));
      if ('error' in type) throw Errors.unsupportedType(type.error);

      const path = joinPath(target.dir, target.name);
      const visibility = opts.visibility ?? existing?.visibility ?? settings.defaultVisibility;
      const result = await this.prisma.$transaction(async (tx) => {
        const current = existing ? await this.files.findByPathHash(pathHash(ctx.projectId, path), ctx.tenantId, ctx.projectId, tx) : null;
        if (current && current.status !== 'PENDING') {
          // Overwrite in place: same file id and path, new object, version + 1.
          await this.quota.apply(tx, ctx.tenantId, written.size - Number(current.sizeBytes), 0);
          const version = current.version + 1;
          const file = await this.files.update(
            current.id,
            {
              storedName: objectId,
              storageKey: key,
              sizeBytes: written.size,
              checksum: written.checksum,
              mimeType: type.mime,
              extension: ext,
              status: 'AVAILABLE',
              visibility,
              version,
            },
            tx,
          );
          await this.files.createVersion(
            { tenantId: ctx.tenantId, fileId: file.id, versionNumber: version, storageKey: key, sizeBytes: written.size, checksum: written.checksum, mimeType: type.mime, createdBy: actorOf(ctx).userId },
            tx,
          );
          await this.files.markVersionsPurged(file.id, version, tx);
          await this.audit.log(ctx, { action: 'FILE_OVERWRITE', resourceType: 'FILE', resourceId: file.id, metadata: { path, version, sizeBytes: written.size } }, tx);
          return { file, replacedKey: current.storageKey, created: false };
        }

        await this.quota.apply(tx, ctx.tenantId, written.size, 1);
        const file = await this.files.create(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            folderId: target.folderId,
            name: target.name,
            originalName: target.name,
            storedName: objectId,
            path,
            pathHash: pathHash(ctx.projectId, path),
            storageProvider: this.storage.providerName,
            storageBucket: this.storage.bucket,
            storageKey: key,
            mimeType: type.mime,
            extension: ext,
            sizeBytes: written.size,
            checksum: written.checksum,
            status: 'AVAILABLE',
            visibility,
            createdBy: actorOf(ctx).userId,
          },
          tx,
        );
        await this.files.createVersion(
          { tenantId: ctx.tenantId, fileId: file.id, versionNumber: 1, storageKey: key, sizeBytes: written.size, checksum: written.checksum, mimeType: type.mime, createdBy: actorOf(ctx).userId },
          tx,
        );
        await this.audit.log(ctx, { action: 'FILE_UPLOAD', resourceType: 'FILE', resourceId: file.id, metadata: { path, sizeBytes: written.size } }, tx);
        return { file, replacedKey: null as string | null, created: true };
      });
      committed = true;

      await this.presenter.invalidatePublic(ctx.projectId, path);
      if (result.replacedKey) await this.jobs.dispatch('purge-objects', { keys: [result.replacedKey] });
      await this.afterAvailable(result.file);
      return { ...(await this.presenter.toDto(result.file)), created: result.created };
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('PATH_EXISTS', 'Another upload to this path finished first - retry');
      throw e;
    } finally {
      if (!committed) await this.storage.delete(key).catch(() => undefined);
    }
  }

  // ─── Signed upload (browser → this server directly, like an S3 presigned PUT) ──────────

  async presign(ctx: ProjectContext, dto: PresignUploadDto) {
    const settings = await this.projects.settingsFor(ctx.tenantId, ctx.projectId);
    let target = await this.resolveTarget(ctx, { name: dto.filename, folderId: dto.folderId, folderPath: dto.folderPath, onConflict: dto.onConflict ?? 'rename' });
    const ext = extensionOf(target.name);
    this.assertExtensionAllowed(ext, settings);
    const maxBytes = this.maxBytes(settings);
    if (dto.sizeBytes > maxBytes) throw Errors.fileTooLarge(maxBytes);
    await this.quota.assertCanStore(ctx.tenantId, dto.sizeBytes);

    if (await this.occupant(ctx, joinPath(target.dir, target.name))) {
      if (dto.onConflict === 'error') throw this.exists(joinPath(target.dir, target.name));
      target = { ...target, name: await this.filesService.freeName(ctx, target.dir, target.name) };
    }
    const path = joinPath(target.dir, target.name);
    const objectId = randomUUID();
    const key = this.storage.objectKey(ctx.tenantId, objectId);
    const expiresIn = this.config.uploadUrlExpires;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        // The PENDING row reserves the path until the upload completes or expires.
        const file = await this.files.create(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            folderId: target.folderId,
            name: target.name,
            originalName: target.name,
            storedName: objectId,
            path,
            pathHash: pathHash(ctx.projectId, path),
            storageProvider: this.storage.providerName,
            storageBucket: this.storage.bucket,
            storageKey: key,
            mimeType: dto.contentType,
            extension: ext,
            sizeBytes: dto.sizeBytes,
            status: 'PENDING',
            visibility: dto.visibility ?? settings.defaultVisibility,
            createdBy: actorOf(ctx).userId,
          },
          tx,
        );
        return this.sessions.create(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            fileId: file.id,
            storageKey: key,
            expectedSize: dto.sizeBytes,
            mimeType: dto.contentType,
            createdBy: actorOf(ctx).userId,
            expiresAt,
          },
          tx,
        );
      });
      return {
        uploadId: session.id,
        fileId: session.fileId,
        path,
        uploadUrl: this.signer.uploadUrl({ u: session.id, t: ctx.tenantId }, expiresIn),
        method: 'PUT',
        headers: { 'Content-Type': dto.contentType },
        expiresIn,
        expiresAt,
      };
    } catch (e) {
      if (isUniqueViolation(e)) throw this.exists(path);
      throw e;
    }
  }

  /** PUT {uploadUrl}: authenticated by the signed token alone (no API key in the browser upload). */
  async receiveContent(uploadId: string, token: string, source: Readable, contentLength?: number) {
    const grant = this.signer.verifyUpload(token);
    if (!grant || grant.u !== uploadId) {
      throw new AppException('INVALID_UPLOAD_TOKEN', 'The upload URL is invalid or has expired', HttpStatus.FORBIDDEN);
    }
    const session = await this.sessions.findByIdAndTenant(uploadId, grant.t);
    if (!session) throw Errors.notFound('upload');
    if (session.status !== 'CREATED' && session.status !== 'UPLOADED') {
      throw Errors.conflict('UPLOAD_CLOSED', 'This upload is already completed or cancelled');
    }
    if (session.expiresAt < new Date()) throw Errors.conflict('UPLOAD_EXPIRED', 'The upload URL has expired');

    const expected = Number(session.expectedSize);
    if (contentLength !== undefined && contentLength !== expected) {
      throw Errors.badRequest('SIZE_MISMATCH', `Expected ${expected} bytes, Content-Length is ${contentLength}`);
    }
    const file = await this.files.findById(session.fileId, session.tenantId, session.projectId);
    if (!file || file.status !== 'PENDING') throw Errors.notFound('upload');

    let written: WrittenObject;
    try {
      written = await this.storage.write(session.storageKey, source, expected);
    } catch (e) {
      if (e instanceof ObjectTooLargeError) throw Errors.badRequest('SIZE_MISMATCH', `Expected exactly ${expected} bytes`);
      throw e;
    }
    if (written.size !== expected) {
      await this.storage.delete(session.storageKey).catch(() => undefined);
      throw Errors.badRequest('SIZE_MISMATCH', `Expected ${expected} bytes, received ${written.size}`);
    }
    const type = resolveFileType(file.extension, detectFileType(written.head));
    if ('error' in type) {
      await this.storage.delete(session.storageKey).catch(() => undefined);
      await this.fail(session.id, session.tenantId, file.id);
      throw Errors.unsupportedType(type.error);
    }
    await this.sessions.transition(session.id, session.tenantId, ['CREATED', 'UPLOADED'], {
      status: 'UPLOADED',
      receivedSize: written.size,
      checksum: written.checksum,
      detectedMime: type.mime,
    });
    return { uploadId: session.id, receivedBytes: written.size };
  }

  /** Verifies the received object and makes the file available. Safe to call twice. */
  async complete(ctx: ProjectContext, uploadId: string) {
    const session = await this.sessions.findByIdAndTenant(uploadId, ctx.tenantId, ctx.projectId);
    if (!session) throw Errors.notFound('upload');
    if (session.status === 'COMPLETED') {
      return this.filesService.get(ctx, session.fileId);
    }
    if (session.status !== 'UPLOADED') {
      throw Errors.conflict('UPLOAD_NOT_RECEIVED', 'Upload the file content to uploadUrl before completing');
    }
    if (session.expiresAt.getTime() + COMPLETE_GRACE_MS < Date.now()) {
      throw Errors.conflict('UPLOAD_EXPIRED', 'The upload session has expired');
    }
    const stat = await this.storage.stat(session.storageKey);
    if (!stat || stat.size !== Number(session.receivedSize)) {
      throw Errors.conflict('UPLOAD_INCOMPLETE', 'The uploaded object is missing or incomplete');
    }

    let file: File;
    try {
      file = await this.prisma.$transaction(async (tx) => {
        const moved = await this.sessions.transition(session.id, ctx.tenantId, ['UPLOADED'], { status: 'COMPLETED', completedAt: new Date() }, tx);
        if (!moved) throw Errors.conflict('UPLOAD_NOT_RECEIVED', 'The upload is not ready to complete');
        await this.quota.apply(tx, ctx.tenantId, stat.size, 1);
        const updated = await this.files.update(
          session.fileId,
          { status: 'AVAILABLE', sizeBytes: stat.size, checksum: session.checksum, mimeType: session.detectedMime ?? session.mimeType },
          tx,
        );
        await this.files.createVersion(
          { tenantId: ctx.tenantId, fileId: updated.id, versionNumber: 1, storageKey: session.storageKey, sizeBytes: stat.size, checksum: session.checksum, mimeType: updated.mimeType, createdBy: actorOf(ctx).userId },
          tx,
        );
        await this.audit.log(ctx, { action: 'FILE_UPLOAD', resourceType: 'FILE', resourceId: updated.id, metadata: { path: updated.path, sizeBytes: stat.size, uploadId } }, tx);
        return updated;
      });
    } catch (e) {
      if (e instanceof AppException && e.code === 'QUOTA_EXCEEDED') {
        await this.fail(session.id, ctx.tenantId, session.fileId);
        await this.storage.delete(session.storageKey).catch(() => undefined);
      }
      throw e;
    }
    await this.presenter.invalidatePublic(file.projectId, file.path);
    await this.afterAvailable(file);
    return this.presenter.toDto(file);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────────────────

  private async afterAvailable(file: File): Promise<void> {
    if (this.config.imageVariantsEager && isRasterImage(file.mimeType)) {
      await this.jobs.dispatch('image-variants', { tenantId: file.tenantId, fileId: file.id });
    }
  }

  /** Marks a pending upload failed and frees its reserved path. */
  private async fail(sessionId: string, tenantId: string, fileId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.transition(sessionId, tenantId, ['CREATED', 'UPLOADED'], { status: 'FAILED' }, tx);
      await this.files.updateIfStatus(fileId, tenantId, ['PENDING'], { status: 'FAILED', pathHash: null }, tx);
    });
  }

  private async resolveTarget(ctx: ProjectContext, opts: Pick<IngestOptions, 'path' | 'name' | 'folderId' | 'folderPath' | 'onConflict'>): Promise<Target> {
    if (opts.path) {
      const { dir, name } = splitPath(normalizePath(opts.path));
      return { folderId: await this.folders.ensurePath(ctx, dir), dir, name };
    }
    const name = normalizeName(opts.name ?? '', 'file name');
    if (opts.folderId) {
      const folder = await this.folders.requireActive(ctx, opts.folderId);
      return { folderId: folder.id, dir: folder.path, name };
    }
    const dir = normalizeFolderPath(opts.folderPath);
    return { folderId: await this.folders.ensurePath(ctx, dir), dir, name };
  }

  /** The file currently holding `path` (live or pending), or null. Folders at the path are an error. */
  private async occupant(ctx: ProjectContext, path: string) {
    const hash = pathHash(ctx.projectId, path);
    const file = await this.files.findByPathHash(hash, ctx.tenantId, ctx.projectId);
    if (file) return file;
    try {
      await this.folders.assertPathFree(ctx, path);
    } catch {
      throw Errors.conflict('PATH_IS_FOLDER', `"${path}" is a folder`);
    }
    return null;
  }

  private assertExtensionAllowed(ext: string, settings: ProjectSettings): void {
    if (BLOCKED_EXTENSIONS.has(ext)) throw Errors.unsupportedType(`.${ext} files are not allowed`);
    if (settings.allowedExtensions && !settings.allowedExtensions.includes(ext)) {
      throw Errors.unsupportedType(ext ? `.${ext} files are not allowed in this project` : 'Files without an extension are not allowed in this project');
    }
  }

  private maxBytes(settings: ProjectSettings): number {
    return Math.min(this.config.maxUploadBytes, settings.maxUploadBytes ?? Number.MAX_SAFE_INTEGER);
  }

  private async writeOrThrow(key: string, source: Readable, maxBytes: number): Promise<WrittenObject> {
    try {
      return await this.storage.write(key, source, maxBytes);
    } catch (e) {
      if (e instanceof ObjectTooLargeError) throw Errors.fileTooLarge(maxBytes);
      throw e;
    }
  }

  private exists(path: string) {
    return Errors.conflict('FILE_EXISTS', `A file already exists at "${path}"`);
  }
}
