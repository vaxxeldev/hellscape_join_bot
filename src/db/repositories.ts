import type {
  ApplicationRecord,
  ApplicationStatus,
  InviteLinkRecord,
  InviteLinkStatus,
  JoinRequestRecord,
  JoinRequestStatus,
  ReservationKind,
  ReservationStatus,
  RoleReservationRecord,
  UserRecord,
  UserStateRecord,
} from "../types.js";
import { nowIso } from "../utils/time.js";
import type { Database } from "./database.js";

const WAITLIST_RESERVE_UNTIL = "9999-12-31T00:00:00.000Z";

export type ApplicationCleanupResult = {
  applications: number;
  inviteLinks: number;
  joinRequests: number;
  adminActions: number;
  userStates: number;
  activeInviteLinks: InviteLinkRecord[];
};

export type DatabaseWipeResult = {
  users: number;
  applications: number;
  inviteLinks: number;
  joinRequests: number;
  roleReservations: number;
  adminActions: number;
  userStates: number;
  activeInviteLinks: InviteLinkRecord[];
};

export class Repositories {
  constructor(private readonly db: Database) {}

  upsertUser(input: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }) {
    this.db.run(
      `
      INSERT INTO users (telegram_id, username, first_name, last_name, updated_at)
      VALUES (:telegramId, :username, :firstName, :lastName, :updatedAt)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = excluded.updated_at
      `,
      {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        updatedAt: nowIso(),
      },
    );
    return this.getUserByTelegramId(input.telegramId)!;
  }

  getUserByTelegramId(telegramId: number) {
    return this.db.get<UserRecord>("SELECT * FROM users WHERE telegram_id = :telegramId", { telegramId });
  }

  getUserById(id: number) {
    return this.db.get<UserRecord>("SELECT * FROM users WHERE id = :id", { id });
  }

  getUserByUsername(username: string) {
    return this.db.get<UserRecord>(
      "SELECT * FROM users WHERE username = :username COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1",
      { username: username.replace(/^@/, "") },
    );
  }

  setUserBanned(telegramId: number, isBanned: boolean, reason: string | null = null) {
    // Each branch binds exactly the named params its SQL references — SQLite
    // rejects extra named parameters, so the unban query must not receive :reason.
    // Unbanning also resets the bot-join counter and ban reason, so /unban gives
    // the user a fresh set of join attempts before the limit auto-bans them again.
    if (isBanned) {
      this.db.run(
        "UPDATE users SET is_banned = 1, ban_reason = :reason, updated_at = :updatedAt WHERE telegram_id = :telegramId",
        { telegramId, reason, updatedAt: nowIso() },
      );
    } else {
      this.db.run(
        "UPDATE users SET is_banned = 0, ban_reason = NULL, bot_join_count = 0, updated_at = :updatedAt WHERE telegram_id = :telegramId",
        { telegramId, updatedAt: nowIso() },
      );
    }
  }

  createApplication(input: {
    userId: number;
    role: string;
    usernameText: string;
    codeWordEntered: string;
    codeWordValid: boolean;
    aboutText: string;
    lifeChannelSubscribed: boolean;
    infoChannelSubscribed: boolean;
  }) {
    const result = this.db.run(
      `
      INSERT INTO applications (
        user_id, role, username_text, code_word_entered, code_word_valid,
        about_text, life_channel_subscribed, info_channel_subscribed, status
      )
      VALUES (
        :userId, :role, :usernameText, :codeWordEntered, :codeWordValid,
        :aboutText, :lifeChannelSubscribed, :infoChannelSubscribed, 'pending'
      )
      `,
      {
        userId: input.userId,
        role: input.role,
        usernameText: input.usernameText,
        codeWordEntered: input.codeWordEntered,
        codeWordValid: input.codeWordValid ? 1 : 0,
        aboutText: input.aboutText,
        lifeChannelSubscribed: input.lifeChannelSubscribed ? 1 : 0,
        infoChannelSubscribed: input.infoChannelSubscribed ? 1 : 0,
      },
    );
    return this.getApplicationById(Number(result.lastInsertRowid))!;
  }

  getApplicationById(id: number) {
    return this.db.get<ApplicationRecord>("SELECT * FROM applications WHERE id = :id", { id });
  }

  getLatestApplicationByTelegramId(telegramId: number) {
    return this.db.get<ApplicationRecord>(
      `
      SELECT a.* FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE u.telegram_id = :telegramId
      ORDER BY a.created_at DESC
      LIMIT 1
      `,
      { telegramId },
    );
  }

  getActiveApplicationByTelegramId(telegramId: number) {
    return this.db.get<ApplicationRecord>(
      `
      SELECT a.* FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE u.telegram_id = :telegramId AND a.status IN ('pending', 'approved')
      ORDER BY a.created_at DESC
      LIMIT 1
      `,
      { telegramId },
    );
  }

  incrementJoinCount(userId: number) {
    this.db.run(
      "UPDATE users SET bot_join_count = bot_join_count + 1, updated_at = :now WHERE id = :id",
      { id: userId, now: nowIso() },
    );
    const row = this.db.get<{ bot_join_count: number }>(
      "SELECT bot_join_count FROM users WHERE id = :id",
      { id: userId },
    );
    return row?.bot_join_count ?? 0;
  }

  countApplicationsLastDay(userId: number) {
    const row = this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM applications WHERE user_id = :userId AND created_at >= datetime('now', '-1 day')",
      { userId },
    );
    return row?.count ?? 0;
  }

  listApplications(limit = 10) {
    return this.db.query<ApplicationRecord>(
      "SELECT * FROM applications ORDER BY created_at DESC LIMIT :limit",
      { limit },
    );
  }

  cleanupApplicationsByDate(date: string): ApplicationCleanupResult {
    const activeInviteLinks = this.db.query<InviteLinkRecord>(
      `
      SELECT il.* FROM invite_links il
      JOIN applications a ON a.id = il.application_id
      WHERE date(a.created_at) = :date AND il.status = 'active'
      `,
      { date },
    );

    return this.db.transaction(() => {
      const userStates = this.db.run(
        `
        DELETE FROM user_states
        WHERE flow = 'application'
          AND telegram_id IN (
            SELECT u.telegram_id
            FROM users u
            JOIN applications a ON a.user_id = u.id
            WHERE date(a.created_at) = :date
          )
        `,
        { date },
      ).changes;

      const joinRequests = this.db.run(
        `
        DELETE FROM join_requests
        WHERE application_id IN (
          SELECT id FROM applications WHERE date(created_at) = :date
        )
        OR invite_link_id IN (
          SELECT il.id
          FROM invite_links il
          JOIN applications a ON a.id = il.application_id
          WHERE date(a.created_at) = :date
        )
        `,
        { date },
      ).changes;

      const inviteLinks = this.db.run(
        `
        DELETE FROM invite_links
        WHERE application_id IN (
          SELECT id FROM applications WHERE date(created_at) = :date
        )
        `,
        { date },
      ).changes;

      const adminActions = this.db.run(
        `
        DELETE FROM admin_actions
        WHERE application_id IN (
          SELECT id FROM applications WHERE date(created_at) = :date
        )
        `,
        { date },
      ).changes;

      const applications = this.db.run(
        "DELETE FROM applications WHERE date(created_at) = :date",
        { date },
      ).changes;

      return { applications, inviteLinks, joinRequests, adminActions, userStates, activeInviteLinks };
    });
  }

  wipeAllData(): DatabaseWipeResult {
    const activeInviteLinks = this.db.query<InviteLinkRecord>(
      "SELECT * FROM invite_links WHERE status = 'active'",
    );

    return this.db.transaction(() => {
      const joinRequests = this.db.run("DELETE FROM join_requests").changes;
      const inviteLinks = this.db.run("DELETE FROM invite_links").changes;
      const applications = this.db.run("DELETE FROM applications").changes;
      const roleReservations = this.db.run("DELETE FROM role_reservations").changes;
      const userStates = this.db.run("DELETE FROM user_states").changes;
      const adminActions = this.db.run("DELETE FROM admin_actions").changes;
      const users = this.db.run("DELETE FROM users").changes;

      this.db.run(
        `
        DELETE FROM sqlite_sequence
        WHERE name IN (
          'users',
          'applications',
          'invite_links',
          'join_requests',
          'admin_actions',
          'role_reservations'
        )
        `,
      );

      return {
        users,
        applications,
        inviteLinks,
        joinRequests,
        roleReservations,
        adminActions,
        userStates,
        activeInviteLinks,
      };
    });
  }

  countApplicationsByUserId(userId: number) {
    const row = this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM applications WHERE user_id = :userId",
      { userId },
    );
    return row?.count ?? 0;
  }

  updateApplicationSubscriptionSnapshot(id: number, life: boolean, info: boolean) {
    this.db.run(
      `
      UPDATE applications
      SET life_channel_subscribed = :life, info_channel_subscribed = :info
      WHERE id = :id
      `,
      { id, life: life ? 1 : 0, info: info ? 1 : 0 },
    );
  }

  updateApplicationStatus(
    id: number,
    status: ApplicationStatus,
    adminId: number | null,
    rejectReason: string | null = null,
  ) {
    this.db.run(
      `
      UPDATE applications
      SET status = :status,
          reviewed_by_admin_id = COALESCE(:adminId, reviewed_by_admin_id),
          reject_reason = :rejectReason,
          reviewed_at = COALESCE(reviewed_at, :reviewedAt)
      WHERE id = :id
      `,
      { id, status, adminId, rejectReason, reviewedAt: nowIso() },
    );
  }

  createInviteLink(input: {
    applicationId: number;
    userId: number;
    inviteLink: string;
    expiresAt: string;
  }) {
    const result = this.db.run(
      `
      INSERT INTO invite_links (application_id, user_id, invite_link, status, expires_at)
      VALUES (:applicationId, :userId, :inviteLink, 'active', :expiresAt)
      `,
      input,
    );
    return this.getInviteLinkById(Number(result.lastInsertRowid))!;
  }

  getInviteLinkById(id: number) {
    return this.db.get<InviteLinkRecord>("SELECT * FROM invite_links WHERE id = :id", { id });
  }

  getInviteLinkByUrl(inviteLink: string) {
    return this.db.get<InviteLinkRecord>("SELECT * FROM invite_links WHERE invite_link = :inviteLink", {
      inviteLink,
    });
  }

  setInviteLinkStatus(id: number, status: InviteLinkStatus) {
    const timestampColumn =
      status === "used" ? "used_at" : status === "revoked" || status === "expired" ? "revoked_at" : null;
    const sql = timestampColumn
      ? `UPDATE invite_links SET status = :status, ${timestampColumn} = :now WHERE id = :id`
      : "UPDATE invite_links SET status = :status WHERE id = :id";
    this.db.run(sql, { id, status, now: nowIso() });
  }

  expireOldInviteLinks() {
    const expired = this.db.query<InviteLinkRecord>(
      `
      SELECT * FROM invite_links
      WHERE status = 'active' AND expires_at <= :now
      `,
      { now: nowIso() },
    );
    this.db.run(
      `
      UPDATE invite_links
      SET status = 'expired', revoked_at = :now
      WHERE status = 'active' AND expires_at <= :now
      `,
      { now: nowIso() },
    );
    return expired;
  }

  createJoinRequest(input: {
    applicationId: number | null;
    userId: number | null;
    inviteLinkId: number | null;
    status?: JoinRequestStatus;
  }) {
    const result = this.db.run(
      `
      INSERT INTO join_requests (application_id, user_id, invite_link_id, status)
      VALUES (:applicationId, :userId, :inviteLinkId, :status)
      `,
      { ...input, status: input.status ?? "pending" },
    );
    return this.getJoinRequestById(Number(result.lastInsertRowid))!;
  }

  getJoinRequestById(id: number) {
    return this.db.get<JoinRequestRecord>("SELECT * FROM join_requests WHERE id = :id", { id });
  }

  setJoinRequestStatus(id: number, status: JoinRequestStatus, adminId: number) {
    this.db.run(
      `
      UPDATE join_requests
      SET status = :status, reviewed_at = :reviewedAt, reviewed_by_admin_id = :adminId
      WHERE id = :id
      `,
      { id, status, adminId, reviewedAt: nowIso() },
    );
  }

  markJoinRequestApprovedByInviteLinkId(inviteLinkId: number) {
    this.db.run(
      `
      UPDATE join_requests
      SET status = 'approved', reviewed_at = :reviewedAt
      WHERE invite_link_id = :inviteLinkId AND status = 'pending'
      `,
      { inviteLinkId, reviewedAt: nowIso() },
    );
  }

  createReservation(input: {
    userId: number;
    roleName: string;
    usernameText: string;
    codeWordEntered: string;
    codeWordValid: boolean;
    reserveUntil?: string;
    reservationKind?: ReservationKind;
  }) {
    const result = this.db.run(
      `
      INSERT INTO role_reservations (
        user_id, role_name, username_text, code_word_entered, code_word_valid, reserve_until, reservation_kind, status
      )
      VALUES (
        :userId, :roleName, :usernameText, :codeWordEntered, :codeWordValid, :reserveUntil, :reservationKind, 'pending'
      )
      `,
      {
        ...input,
        reserveUntil: input.reserveUntil ?? WAITLIST_RESERVE_UNTIL,
        reservationKind: input.reservationKind ?? "scheduled",
        codeWordValid: input.codeWordValid ? 1 : 0,
      },
    );
    return this.getReservationById(Number(result.lastInsertRowid))!;
  }

  getReservationById(id: number) {
    return this.db.get<RoleReservationRecord>("SELECT * FROM role_reservations WHERE id = :id", { id });
  }

  getActiveReservationByTelegramId(telegramId: number) {
    return this.db.get<RoleReservationRecord>(
      `
      SELECT r.* FROM role_reservations r
      JOIN users u ON u.id = r.user_id
      WHERE u.telegram_id = :telegramId AND r.status IN ('pending', 'approved')
      ORDER BY r.created_at DESC
      LIMIT 1
      `,
      { telegramId },
    );
  }

  listReservations(statuses: ReservationStatus[], limit = 20) {
    const placeholders = statuses.map((_, index) => `:s${index}`).join(", ");
    const params = Object.fromEntries(statuses.map((status, index) => [`s${index}`, status]));
    return this.db.query<RoleReservationRecord>(
      `SELECT * FROM role_reservations WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT :limit`,
      { ...params, limit },
    );
  }

  getNextWaitlistReservation() {
    return this.db.get<RoleReservationRecord>(
      `
      SELECT * FROM role_reservations
      WHERE reservation_kind = 'waitlist'
        AND status = 'approved'
        AND waitlist_notified_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      `,
    );
  }

  hasActiveWaitlistGate(inviteExpireHours: number) {
    const cutoff = new Date(Date.now() - inviteExpireHours * 60 * 60 * 1000).toISOString();
    const row = this.db.get<{ count: number }>(
      `
      SELECT COUNT(*) AS count FROM role_reservations
      WHERE reservation_kind = 'waitlist'
        AND (
          (status = 'approved' AND waitlist_notified_at IS NOT NULL)
          OR (status = 'used' AND updated_at > :cutoff)
        )
      `,
      { cutoff },
    );
    return Boolean(row?.count);
  }

  updateReservationStatus(
    id: number,
    status: ReservationStatus,
    adminId: number | null,
    rejectReason: string | null = null,
  ) {
    this.db.run(
      `
      UPDATE role_reservations
      SET status = :status,
          reviewed_by_admin_id = COALESCE(:adminId, reviewed_by_admin_id),
          reject_reason = :rejectReason,
          reviewed_at = COALESCE(reviewed_at, :reviewedAt),
          updated_at = :reviewedAt
      WHERE id = :id
      `,
      { id, status, adminId, rejectReason, reviewedAt: nowIso() },
    );
  }

  updateReservationDate(id: number, reserveUntil: string) {
    this.db.run(
      `
      UPDATE role_reservations
      SET reserve_until = :reserveUntil,
          reminder_sent_at = NULL,
          updated_at = :updatedAt
      WHERE id = :id
      `,
      { id, reserveUntil, updatedAt: nowIso() },
    );
  }

  markReservationReminderSent(id: number) {
    this.db.run(
      `
      UPDATE role_reservations
      SET reminder_sent_at = :reminderSentAt,
          updated_at = :reminderSentAt
      WHERE id = :id
      `,
      { id, reminderSentAt: nowIso() },
    );
  }

  markWaitlistNotified(id: number) {
    this.db.run(
      `
      UPDATE role_reservations
      SET waitlist_notified_at = :notifiedAt,
          updated_at = :notifiedAt
      WHERE id = :id
      `,
      { id, notifiedAt: nowIso() },
    );
  }

  resetWaitlistNotification(id: number) {
    this.db.run(
      `
      UPDATE role_reservations
      SET waitlist_notified_at = NULL,
          updated_at = :updatedAt
      WHERE id = :id
      `,
      { id, updatedAt: nowIso() },
    );
  }

  deleteReservation(id: number) {
    this.db.run("DELETE FROM role_reservations WHERE id = :id", { id });
  }

  expireReservations() {
    const due = this.db.query<RoleReservationRecord>(
      `
      SELECT * FROM role_reservations
      WHERE reservation_kind = 'scheduled'
        AND status = 'approved'
        AND date(reserve_until) <= date(:now)
        AND reminder_sent_at IS NULL
      `,
      { now: nowIso() },
    );
    for (const reservation of due) this.markReservationReminderSent(reservation.id);
    return due;
  }

  getState(telegramId: number) {
    return this.db.get<UserStateRecord>("SELECT * FROM user_states WHERE telegram_id = :telegramId", {
      telegramId,
    });
  }

  setState(telegramId: number, flow: string, step: string, data: unknown) {
    this.db.run(
      `
      INSERT INTO user_states (telegram_id, flow, step, data, updated_at)
      VALUES (:telegramId, :flow, :step, :data, :updatedAt)
      ON CONFLICT(telegram_id) DO UPDATE SET
        flow = excluded.flow,
        step = excluded.step,
        data = excluded.data,
        updated_at = excluded.updated_at
      `,
      { telegramId, flow, step, data: JSON.stringify(data), updatedAt: nowIso() },
    );
  }

  clearState(telegramId: number) {
    this.db.run("DELETE FROM user_states WHERE telegram_id = :telegramId", { telegramId });
  }

  logAdminAction(input: {
    adminId: number;
    action: string;
    targetUserId?: number | null;
    applicationId?: number | null;
    details?: string | null;
  }) {
    this.db.run(
      `
      INSERT INTO admin_actions (admin_id, action, target_user_id, application_id, details)
      VALUES (:adminId, :action, :targetUserId, :applicationId, :details)
      `,
      {
        adminId: input.adminId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        applicationId: input.applicationId ?? null,
        details: input.details ?? null,
      },
    );
  }

  stats() {
    const total = this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM applications")?.count ?? 0;
    const pending =
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM applications WHERE status = 'pending'")?.count ??
      0;
    const approved =
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM applications WHERE status = 'approved'")?.count ??
      0;
    const rejected =
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM applications WHERE status = 'rejected'")?.count ??
      0;
    const joined =
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM applications WHERE status = 'joined'")?.count ??
      0;
    const today =
      this.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM applications WHERE date(created_at) = date('now')",
      )?.count ?? 0;
    const uniqueUsers = this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0;

    return { total, pending, approved, rejected, joined, today, uniqueUsers };
  }
}
