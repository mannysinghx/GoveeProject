import crypto from 'node:crypto';
import type { Logger } from 'pino';
import {
  OFFICIAL_SHARER_NAME,
  SHARE_LIMITS,
  sharedBundleSchema,
  type AdminSharedItemDto,
  type ImportPreviewDto,
  type ImportRequest,
  type ImportResultDto,
  type ShareAllResultDto,
  type SharedBundle,
  type SharedItemDto,
  type SharedKind,
  type SharedListDto,
  type ShareRequest,
  type ShareUpdate,
} from '@glm/shared';
import type { AccountContext } from '../app/context.js';
import type { AccountRegistry } from '../app/accounts.js';
import type { AuthService, SessionInfo } from '../auth/auth-service.js';
import type { Db } from '../database/database.js';
import { hitLimit } from '../security/limits.js';
import { AppError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import { assertNoLinks, buildShare, summarize } from './bundle.js';
import { importedBefore, previewImport, runImport, type ImportSource } from './importer.js';

interface SharedRow {
  id: string;
  user_id: number;
  kind: SharedKind;
  source_id: string;
  title: string;
  description: string;
  bundle_json: string;
  hidden_at: string | null;
  imports: number;
  created_at: string;
  updated_at: string;
  role: 'owner' | 'member';
  display_name: string | null;
  email: string | null;
}

const ROW_SELECT = `SELECT s.*, u.role, u.display_name, u.email FROM shared_items s JOIN users u ON u.id = s.user_id`;

export interface SharingDeps {
  control: Db;
  accounts: AccountRegistry;
  auth: AuthService;
  clock: Clock;
  logger: Logger;
}

/**
 * The Shared space. Shares live in the control database, as snapshots that hold nothing from
 * the sharer's account; imports write only into the importer's own account. A share is read
 * from, and an import written to, the signed-in person's own account and nobody else's.
 */
export class SharingService {
  private readonly control: Db;

  constructor(private readonly deps: SharingDeps) {
    this.control = deps.control;
  }

  private account(userId: number): AccountContext {
    const account = this.deps.accounts.forUser(userId) ?? this.deps.accounts.ensure(userId);
    if (!account) throw new AppError(503, 'account_unavailable', 'Your account is not available right now. Try again in a minute.');
    return account;
  }

  private userInfo(userId: number): { display_name: string | null; sharing_blocked: number; role: 'owner' | 'member' } {
    return this.control.prepare('SELECT display_name, sharing_blocked, role FROM users WHERE id = ?').get(userId) as {
      display_name: string | null;
      sharing_blocked: number;
      role: 'owner' | 'member';
    };
  }

  private by(row: Pick<SharedRow, 'role' | 'display_name'>): string {
    return row.role === 'owner' ? OFFICIAL_SHARER_NAME : (row.display_name ?? 'Someone');
  }

  private bundleOf(row: SharedRow): SharedBundle {
    // Checked again on the way out: a stored bundle is never trusted.
    const parsed = sharedBundleSchema.safeParse(JSON.parse(row.bundle_json));
    if (!parsed.success) throw new AppError(500, 'shared_item_unreadable', `"${row.title}" cannot be read.`);
    return parsed.data;
  }

  private toDto(row: SharedRow, viewer: number, imported: Set<string>): SharedItemDto {
    const summary = summarize(this.bundleOf(row));
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      by: this.by(row),
      official: row.role === 'owner',
      mine: row.user_id === viewer,
      sourceId: row.user_id === viewer ? row.source_id : null,
      hidden: row.hidden_at !== null,
      ...summary,
      importedByMe: imported.has(row.id),
      imports: row.imports,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /* ------------------------------- display names ------------------------------ */

  setDisplayName(session: SessionInfo, displayName: string, ip: string): { displayName: string } {
    if (displayName.toLowerCase() === OFFICIAL_SHARER_NAME.toLowerCase() && session.role !== 'owner') {
      throw new AppError(409, 'display_name_taken', 'That name is taken. Choose another.');
    }
    const taken = this.control.prepare('SELECT id FROM users WHERE display_name = ? COLLATE NOCASE').get(displayName) as { id: number } | undefined;
    if (taken && taken.id !== session.userId) throw new AppError(409, 'display_name_taken', 'That name is taken. Choose another.');
    this.control.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(displayName, this.deps.clock.nowIso(), session.userId);
    this.deps.auth.audit(session.userId, 'display_name_set', ip);
    return { displayName };
  }

  /* ---------------------------------- sharing --------------------------------- */

  list(session: SessionInfo): SharedListDto {
    const rows = this.control
      .prepare(`${ROW_SELECT} WHERE s.hidden_at IS NULL OR s.user_id = ? ORDER BY (u.role = 'owner') DESC, s.updated_at DESC`)
      .all(session.userId) as SharedRow[];
    const imported = importedBefore(this.account(session.userId), rows.map((r) => r.id));
    const me = this.userInfo(session.userId);
    return {
      items: rows.map((row) => this.toDto(row, session.userId, imported)),
      displayName: session.role === 'owner' ? OFFICIAL_SHARER_NAME : me.display_name,
      canShare: me.sharing_blocked === 0,
      shareLimit: session.role === 'owner' ? null : SHARE_LIMITS.itemsPerMember,
      sharedCount: rows.filter((r) => r.user_id === session.userId).length,
    };
  }

  private assertMayShare(session: SessionInfo, adding: number): void {
    const me = this.userInfo(session.userId);
    if (me.sharing_blocked) throw new AppError(403, 'sharing_blocked', 'Sharing is turned off for your account.');
    if (session.role === 'owner') return;
    if (!me.display_name) throw new AppError(409, 'display_name_required', 'Choose a display name first. It shows on what you share.');
    const { n } = this.control.prepare('SELECT COUNT(*) AS n FROM shared_items WHERE user_id = ?').get(session.userId) as { n: number };
    if (n + adding > SHARE_LIMITS.itemsPerMember) {
      throw new AppError(409, 'share_limit_reached', `You can share up to ${SHARE_LIMITS.itemsPerMember} items. Stop sharing one to make room.`);
    }
    if (!hitLimit(this.control, `share:user:${session.userId}`, SHARE_LIMITS.sharesPerHour, 3600_000, this.deps.clock.nowMs())) {
      throw new AppError(429, 'too_many_shares', 'You have shared a lot in the last hour. Try again later.', undefined, 600);
    }
  }

  private row(id: string): SharedRow | null {
    return (this.control.prepare(`${ROW_SELECT} WHERE s.id = ?`).get(id) as SharedRow | undefined) ?? null;
  }

  private ownRow(session: SessionInfo, id: string): SharedRow {
    const row = this.row(id);
    if (!row || row.user_id !== session.userId) throw new AppError(404, 'not_found', 'That shared item was not found.');
    return row;
  }

  share(session: SessionInfo, request: ShareRequest, ip: string): SharedItemDto {
    this.assertMayShare(session, 1);
    const exists = this.control
      .prepare('SELECT id FROM shared_items WHERE user_id = ? AND kind = ? AND source_id = ?')
      .get(session.userId, request.kind, request.sourceId) as { id: string } | undefined;
    if (exists) throw new AppError(409, 'already_shared', 'This is already shared. Update the share instead.', { id: exists.id });
    const built = buildShare(this.account(session.userId), request.kind, request.sourceId, request);
    const id = crypto.randomUUID();
    const now = this.deps.clock.nowIso();
    this.control
      .prepare(
        `INSERT INTO shared_items (id, user_id, kind, source_id, title, description, bundle_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, session.userId, request.kind, request.sourceId, built.title, built.description, JSON.stringify(built.bundle), now, now);
    this.deps.auth.audit(session.userId, 'shared', ip, { id, kind: request.kind });
    return this.toDto(this.row(id)!, session.userId, new Set());
  }

  update(session: SessionInfo, id: string, update: ShareUpdate, ip: string): SharedItemDto {
    const row = this.ownRow(session, id);
    this.assertMayShare(session, 0);
    const title = update.title ?? row.title;
    const description = update.description ?? row.description;
    const old = this.bundleOf(row);
    const labels = { ...Object.fromEntries(old.slots.map((s) => [s.key, s.label])), ...(update.slotLabels ?? {}) };
    let built: { bundle: SharedBundle; title: string; description: string };
    if (update.refresh) {
      built = buildShare(this.account(session.userId), row.kind, row.source_id, { title, description, slotLabels: labels });
    } else {
      // Only the words change: the snapshot stays as it was.
      const bundle = sharedBundleSchema.parse({ ...old, slots: old.slots.map((s) => ({ ...s, label: labels[s.key] ?? s.label })) });
      assertNoLinks(bundle, title, description);
      built = { bundle, title, description };
    }
    this.control
      .prepare('UPDATE shared_items SET title = ?, description = ?, bundle_json = ?, updated_at = ? WHERE id = ?')
      .run(built.title, built.description, JSON.stringify(built.bundle), this.deps.clock.nowIso(), id);
    this.deps.auth.audit(session.userId, 'share_updated', ip, { id });
    return this.toDto(this.row(id)!, session.userId, new Set());
  }

  stop(session: SessionInfo, id: string, ip: string): void {
    this.ownRow(session, id);
    this.control.prepare('DELETE FROM shared_items WHERE id = ?').run(id);
    this.deps.auth.audit(session.userId, 'share_stopped', ip, { id });
  }

  /** The owner's "share everything": each of their own presets, groups and schedules not yet shared. */
  shareAll(session: SessionInfo, ip: string): ShareAllResultDto {
    if (session.role !== 'owner') throw new AppError(403, 'forbidden', 'Only the owner can share everything at once.');
    const account = this.account(session.userId);
    const sources: { kind: SharedKind; id: string; name: string }[] = [
      ...account.groups.list().map((g) => ({ kind: 'group' as const, id: g.id, name: g.name })),
      ...account.presets.list().filter((p) => !p.builtin).map((p) => ({ kind: 'preset' as const, id: p.id, name: p.name })),
      ...account.schedules.list().filter((s) => !s.builtinShow).map((s) => ({ kind: 'schedule' as const, id: s.id, name: s.name })),
    ];
    const already = new Set(
      (this.control.prepare('SELECT kind, source_id FROM shared_items WHERE user_id = ?').all(session.userId) as { kind: string; source_id: string }[]).map(
        (r) => `${r.kind}:${r.source_id}`,
      ),
    );
    const result: ShareAllResultDto = { shared: 0, skipped: [] };
    for (const source of sources) {
      if (already.has(`${source.kind}:${source.id}`)) continue;
      try {
        this.share(session, { kind: source.kind, sourceId: source.id }, ip);
        result.shared++;
      } catch (error) {
        result.skipped.push({ name: source.name, reason: error instanceof AppError ? error.message : 'It could not be shared.' });
      }
    }
    return result;
  }

  /* ---------------------------------- import ---------------------------------- */

  private sources(session: SessionInfo, itemIds: string[]): ImportSource[] {
    return [...new Set(itemIds)].map((id) => {
      const row = this.row(id);
      // Hidden items can be imported only by the person who shared them.
      if (!row || (row.hidden_at !== null && row.user_id !== session.userId)) {
        throw new AppError(404, 'not_found', 'One of those shared items is no longer available.');
      }
      return { shareId: row.id, by: this.by(row), bundle: this.bundleOf(row) };
    });
  }

  preview(session: SessionInfo, itemIds: string[]): ImportPreviewDto {
    const sources = this.sources(session, itemIds);
    const account = this.account(session.userId);
    const before = importedBefore(account, sources.map((s) => s.shareId));
    const titles = sources.filter((s) => before.has(s.shareId)).map((s) => this.row(s.shareId)?.title ?? '');
    return previewImport(account, sources, titles);
  }

  import(session: SessionInfo, request: ImportRequest, ip: string): ImportResultDto {
    const sources = this.sources(session, request.itemIds);
    const result = runImport(this.account(session.userId), session.role, sources, request.slots, request.scenes);
    const bump = this.control.prepare('UPDATE shared_items SET imports = imports + 1 WHERE id = ?');
    this.control.transaction(() => {
      for (const source of sources) bump.run(source.shareId);
    })();
    this.deps.auth.audit(session.userId, 'imported', ip, { items: sources.length, ...result.created });
    return result;
  }

  /* ---------------------------------- owner ----------------------------------- */

  adminList(adminId: number): AdminSharedItemDto[] {
    const rows = this.control.prepare(`${ROW_SELECT} ORDER BY s.updated_at DESC`).all() as SharedRow[];
    return rows.map((row) => ({ ...this.toDto(row, adminId, new Set()), sharerId: row.user_id, sharerEmail: row.email }));
  }

  setHidden(adminId: number, id: string, hidden: boolean, ip: string): AdminSharedItemDto[] {
    if (!this.row(id)) throw new AppError(404, 'not_found', 'That shared item was not found.');
    this.control.prepare('UPDATE shared_items SET hidden_at = ? WHERE id = ?').run(hidden ? this.deps.clock.nowIso() : null, id);
    this.deps.auth.audit(adminId, hidden ? 'share_hidden' : 'share_shown', ip, { id });
    return this.adminList(adminId);
  }

  remove(adminId: number, id: string, ip: string): AdminSharedItemDto[] {
    if (!this.row(id)) throw new AppError(404, 'not_found', 'That shared item was not found.');
    this.control.prepare('DELETE FROM shared_items WHERE id = ?').run(id);
    this.deps.auth.audit(adminId, 'share_removed', ip, { id });
    return this.adminList(adminId);
  }

  setSharingBlocked(adminId: number, userId: number, blocked: boolean, ip: string): void {
    const user = this.control.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
    if (!user) throw new AppError(404, 'not_found', 'That account was not found.');
    if (user.role === 'owner') throw new AppError(409, 'owner_account', "The owner's own sharing cannot be turned off.");
    this.control.prepare('UPDATE users SET sharing_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, userId);
    this.deps.auth.audit(adminId, blocked ? 'sharing_blocked' : 'sharing_allowed', ip, { userId });
  }

  resetDisplayName(adminId: number, userId: number, ip: string): void {
    const user = this.control.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new AppError(404, 'not_found', 'That account was not found.');
    this.control.prepare('UPDATE users SET display_name = NULL WHERE id = ?').run(userId);
    this.deps.auth.audit(adminId, 'display_name_reset', ip, { userId });
  }

  /** What one person has shared, for their own data download. */
  exportFor(userId: number): { title: string; kind: string; description: string; createdAt: string; updatedAt: string; imports: number }[] {
    const rows = this.control
      .prepare('SELECT title, kind, description, created_at, updated_at, imports FROM shared_items WHERE user_id = ? ORDER BY created_at')
      .all(userId) as { title: string; kind: string; description: string; created_at: string; updated_at: string; imports: number }[];
    return rows.map((r) => ({ title: r.title, kind: r.kind, description: r.description, createdAt: r.created_at, updatedAt: r.updated_at, imports: r.imports }));
  }
}
