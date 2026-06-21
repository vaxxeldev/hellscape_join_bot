import { nowIso } from "../utils/time.js";
const WAITLIST_RESERVE_UNTIL = "9999-12-31T00:00:00.000Z";
export class Repositories {
    db;
    constructor(db) {
        this.db = db;
    }
    upsertUser(input) {
        this.db.run(`
      INSERT INTO users (telegram_id, username, first_name, last_name, updated_at)
      VALUES (:telegramId, :username, :firstName, :lastName, :updatedAt)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = excluded.updated_at
      `, {
            telegramId: input.telegramId,
            username: input.username ?? null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            updatedAt: nowIso(),
        });
        return this.getUserByTelegramId(input.telegramId);
    }
    getUserByTelegramId(telegramId) {
        return this.db.get("SELECT * FROM users WHERE telegram_id = :telegramId", { telegramId });
    }
    getUserById(id) {
        return this.db.get("SELECT * FROM users WHERE id = :id", { id });
    }
    getUserByUsername(username) {
        return this.db.get("SELECT * FROM users WHERE username = :username COLLATE NOCASE ORDER BY updated_at DESC LIMIT 1", { username: username.replace(/^@/, "") });
    }
    setUserBanned(telegramId, isBanned, reason = null) {
        // Each branch binds exactly the named params its SQL references — node:sqlite
        // rejects extra named parameters, so the unban query must not receive :reason.
        // Unbanning also resets the bot-join counter and ban reason, so /unban gives
        // the user a fresh set of join attempts before the limit auto-bans them again.
        if (isBanned) {
            this.db.run("UPDATE users SET is_banned = 1, ban_reason = :reason, updated_at = :updatedAt WHERE telegram_id = :telegramId", { telegramId, reason, updatedAt: nowIso() });
        }
        else {
            this.db.run("UPDATE users SET is_banned = 0, ban_reason = NULL, bot_join_count = 0, updated_at = :updatedAt WHERE telegram_id = :telegramId", { telegramId, updatedAt: nowIso() });
        }
    }
    createApplication(input) {
        const result = this.db.run(`
      INSERT INTO applications (
        user_id, role, username_text, code_word_entered, code_word_valid,
        about_text, life_channel_subscribed, info_channel_subscribed, status
      )
      VALUES (
        :userId, :role, :usernameText, :codeWordEntered, :codeWordValid,
        :aboutText, :lifeChannelSubscribed, :infoChannelSubscribed, 'pending'
      )
      `, {
            userId: input.userId,
            role: input.role,
            usernameText: input.usernameText,
            codeWordEntered: input.codeWordEntered,
            codeWordValid: input.codeWordValid ? 1 : 0,
            aboutText: input.aboutText,
            lifeChannelSubscribed: input.lifeChannelSubscribed ? 1 : 0,
            infoChannelSubscribed: input.infoChannelSubscribed ? 1 : 0,
        });
        return this.getApplicationById(Number(result.lastInsertRowid));
    }
    getApplicationById(id) {
        return this.db.get("SELECT * FROM applications WHERE id = :id", { id });
    }
    getLatestApplicationByTelegramId(telegramId) {
        return this.db.get(`
      SELECT a.* FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE u.telegram_id = :telegramId
      ORDER BY a.created_at DESC
      LIMIT 1
      `, { telegramId });
    }
    getActiveApplicationByTelegramId(telegramId) {
        return this.db.get(`
      SELECT a.* FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE u.telegram_id = :telegramId AND a.status IN ('pending', 'approved')
      ORDER BY a.created_at DESC
      LIMIT 1
      `, { telegramId });
    }
    incrementJoinCount(userId) {
        this.db.run("UPDATE users SET bot_join_count = bot_join_count + 1, updated_at = :now WHERE id = :id", { id: userId, now: nowIso() });
        const row = this.db.get("SELECT bot_join_count FROM users WHERE id = :id", { id: userId });
        return row?.bot_join_count ?? 0;
    }
    countApplicationsLastDay(userId) {
        const row = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE user_id = :userId AND created_at >= datetime('now', '-1 day')", { userId });
        return row?.count ?? 0;
    }
    listApplications(limit = 10) {
        return this.db.query("SELECT * FROM applications ORDER BY created_at DESC LIMIT :limit", { limit });
    }
    countApplicationsByUserId(userId) {
        const row = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE user_id = :userId", { userId });
        return row?.count ?? 0;
    }
    updateApplicationSubscriptionSnapshot(id, life, info) {
        this.db.run(`
      UPDATE applications
      SET life_channel_subscribed = :life, info_channel_subscribed = :info
      WHERE id = :id
      `, { id, life: life ? 1 : 0, info: info ? 1 : 0 });
    }
    updateApplicationStatus(id, status, adminId, rejectReason = null) {
        this.db.run(`
      UPDATE applications
      SET status = :status,
          reviewed_by_admin_id = COALESCE(:adminId, reviewed_by_admin_id),
          reject_reason = :rejectReason,
          reviewed_at = COALESCE(reviewed_at, :reviewedAt)
      WHERE id = :id
      `, { id, status, adminId, rejectReason, reviewedAt: nowIso() });
    }
    createInviteLink(input) {
        const result = this.db.run(`
      INSERT INTO invite_links (application_id, user_id, invite_link, status, expires_at)
      VALUES (:applicationId, :userId, :inviteLink, 'active', :expiresAt)
      `, input);
        return this.getInviteLinkById(Number(result.lastInsertRowid));
    }
    getInviteLinkById(id) {
        return this.db.get("SELECT * FROM invite_links WHERE id = :id", { id });
    }
    getInviteLinkByUrl(inviteLink) {
        return this.db.get("SELECT * FROM invite_links WHERE invite_link = :inviteLink", {
            inviteLink,
        });
    }
    setInviteLinkStatus(id, status) {
        const timestampColumn = status === "used" ? "used_at" : status === "revoked" || status === "expired" ? "revoked_at" : null;
        const sql = timestampColumn
            ? `UPDATE invite_links SET status = :status, ${timestampColumn} = :now WHERE id = :id`
            : "UPDATE invite_links SET status = :status WHERE id = :id";
        this.db.run(sql, { id, status, now: nowIso() });
    }
    expireOldInviteLinks() {
        const expired = this.db.query(`
      SELECT * FROM invite_links
      WHERE status = 'active' AND expires_at <= :now
      `, { now: nowIso() });
        this.db.run(`
      UPDATE invite_links
      SET status = 'expired', revoked_at = :now
      WHERE status = 'active' AND expires_at <= :now
      `, { now: nowIso() });
        return expired;
    }
    createJoinRequest(input) {
        const result = this.db.run(`
      INSERT INTO join_requests (application_id, user_id, invite_link_id, status)
      VALUES (:applicationId, :userId, :inviteLinkId, :status)
      `, { ...input, status: input.status ?? "pending" });
        return this.getJoinRequestById(Number(result.lastInsertRowid));
    }
    getJoinRequestById(id) {
        return this.db.get("SELECT * FROM join_requests WHERE id = :id", { id });
    }
    setJoinRequestStatus(id, status, adminId) {
        this.db.run(`
      UPDATE join_requests
      SET status = :status, reviewed_at = :reviewedAt, reviewed_by_admin_id = :adminId
      WHERE id = :id
      `, { id, status, adminId, reviewedAt: nowIso() });
    }
    markJoinRequestApprovedByInviteLinkId(inviteLinkId) {
        this.db.run(`
      UPDATE join_requests
      SET status = 'approved', reviewed_at = :reviewedAt
      WHERE invite_link_id = :inviteLinkId AND status = 'pending'
      `, { inviteLinkId, reviewedAt: nowIso() });
    }
    createReservation(input) {
        const result = this.db.run(`
      INSERT INTO role_reservations (
        user_id, role_name, username_text, code_word_entered, code_word_valid, reserve_until, reservation_kind, status
      )
      VALUES (
        :userId, :roleName, :usernameText, :codeWordEntered, :codeWordValid, :reserveUntil, :reservationKind, 'pending'
      )
      `, {
            ...input,
            reserveUntil: input.reserveUntil ?? WAITLIST_RESERVE_UNTIL,
            reservationKind: input.reservationKind ?? "scheduled",
            codeWordValid: input.codeWordValid ? 1 : 0,
        });
        return this.getReservationById(Number(result.lastInsertRowid));
    }
    getReservationById(id) {
        return this.db.get("SELECT * FROM role_reservations WHERE id = :id", { id });
    }
    getActiveReservationByTelegramId(telegramId) {
        return this.db.get(`
      SELECT r.* FROM role_reservations r
      JOIN users u ON u.id = r.user_id
      WHERE u.telegram_id = :telegramId AND r.status IN ('pending', 'approved')
      ORDER BY r.created_at DESC
      LIMIT 1
      `, { telegramId });
    }
    listReservations(statuses, limit = 20) {
        const placeholders = statuses.map((_, index) => `:s${index}`).join(", ");
        const params = Object.fromEntries(statuses.map((status, index) => [`s${index}`, status]));
        return this.db.query(`SELECT * FROM role_reservations WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT :limit`, { ...params, limit });
    }
    getNextWaitlistReservation() {
        return this.db.get(`
      SELECT * FROM role_reservations
      WHERE reservation_kind = 'waitlist'
        AND status = 'approved'
        AND waitlist_notified_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      `);
    }
    hasActiveWaitlistGate(inviteExpireHours) {
        const cutoff = new Date(Date.now() - inviteExpireHours * 60 * 60 * 1000).toISOString();
        const row = this.db.get(`
      SELECT COUNT(*) AS count FROM role_reservations
      WHERE reservation_kind = 'waitlist'
        AND (
          (status = 'approved' AND waitlist_notified_at IS NOT NULL)
          OR (status = 'used' AND updated_at > :cutoff)
        )
      `, { cutoff });
        return Boolean(row?.count);
    }
    updateReservationStatus(id, status, adminId, rejectReason = null) {
        this.db.run(`
      UPDATE role_reservations
      SET status = :status,
          reviewed_by_admin_id = COALESCE(:adminId, reviewed_by_admin_id),
          reject_reason = :rejectReason,
          reviewed_at = COALESCE(reviewed_at, :reviewedAt),
          updated_at = :reviewedAt
      WHERE id = :id
      `, { id, status, adminId, rejectReason, reviewedAt: nowIso() });
    }
    updateReservationDate(id, reserveUntil) {
        this.db.run(`
      UPDATE role_reservations
      SET reserve_until = :reserveUntil,
          reminder_sent_at = NULL,
          updated_at = :updatedAt
      WHERE id = :id
      `, { id, reserveUntil, updatedAt: nowIso() });
    }
    markReservationReminderSent(id) {
        this.db.run(`
      UPDATE role_reservations
      SET reminder_sent_at = :reminderSentAt,
          updated_at = :reminderSentAt
      WHERE id = :id
      `, { id, reminderSentAt: nowIso() });
    }
    markWaitlistNotified(id) {
        this.db.run(`
      UPDATE role_reservations
      SET waitlist_notified_at = :notifiedAt,
          updated_at = :notifiedAt
      WHERE id = :id
      `, { id, notifiedAt: nowIso() });
    }
    resetWaitlistNotification(id) {
        this.db.run(`
      UPDATE role_reservations
      SET waitlist_notified_at = NULL,
          updated_at = :updatedAt
      WHERE id = :id
      `, { id, updatedAt: nowIso() });
    }
    deleteReservation(id) {
        this.db.run("DELETE FROM role_reservations WHERE id = :id", { id });
    }
    expireReservations() {
        const due = this.db.query(`
      SELECT * FROM role_reservations
      WHERE reservation_kind = 'scheduled'
        AND status = 'approved'
        AND date(reserve_until) <= date(:now)
        AND reminder_sent_at IS NULL
      `, { now: nowIso() });
        for (const reservation of due)
            this.markReservationReminderSent(reservation.id);
        return due;
    }
    getState(telegramId) {
        return this.db.get("SELECT * FROM user_states WHERE telegram_id = :telegramId", {
            telegramId,
        });
    }
    setState(telegramId, flow, step, data) {
        this.db.run(`
      INSERT INTO user_states (telegram_id, flow, step, data, updated_at)
      VALUES (:telegramId, :flow, :step, :data, :updatedAt)
      ON CONFLICT(telegram_id) DO UPDATE SET
        flow = excluded.flow,
        step = excluded.step,
        data = excluded.data,
        updated_at = excluded.updated_at
      `, { telegramId, flow, step, data: JSON.stringify(data), updatedAt: nowIso() });
    }
    clearState(telegramId) {
        this.db.run("DELETE FROM user_states WHERE telegram_id = :telegramId", { telegramId });
    }
    logAdminAction(input) {
        this.db.run(`
      INSERT INTO admin_actions (admin_id, action, target_user_id, application_id, details)
      VALUES (:adminId, :action, :targetUserId, :applicationId, :details)
      `, {
            adminId: input.adminId,
            action: input.action,
            targetUserId: input.targetUserId ?? null,
            applicationId: input.applicationId ?? null,
            details: input.details ?? null,
        });
    }
    stats() {
        const total = this.db.get("SELECT COUNT(*) AS count FROM applications")?.count ?? 0;
        const pending = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'pending'")?.count ??
            0;
        const approved = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'approved'")?.count ??
            0;
        const rejected = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'rejected'")?.count ??
            0;
        const joined = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'joined'")?.count ??
            0;
        const today = this.db.get("SELECT COUNT(*) AS count FROM applications WHERE date(created_at) = date('now')")?.count ?? 0;
        const uniqueUsers = this.db.get("SELECT COUNT(*) AS count FROM users")?.count ?? 0;
        return { total, pending, approved, rejected, joined, today, uniqueUsers };
    }
}
