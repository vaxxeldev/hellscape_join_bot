import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Telegraf } from "telegraf";
import type { AppConfig } from "../src/config/env.js";
import { Database } from "../src/db/database.js";
import { Repositories } from "../src/db/repositories.js";
import { JoinRequestHandlers } from "../src/bot/joinRequests.js";
import { expireTrackedInviteLinks, issueJoinRequestInvite } from "../src/services/invites.js";
import type { BotContext, ReservationKind } from "../src/types.js";

const config = {
  botToken: "test",
  lifeChannelId: -1001,
  infoChannelId: -1002,
  mainChatId: -1003,
  adminChatId: -1004,
  rulesUrl: "https://t.me/rules/1",
  lifeChannelUrl: "https://t.me/life",
  infoChannelUrl: "https://t.me/info",
  rolePostUrls: { genshin: "https://t.me/info/2", hsr: "https://t.me/info/3" },
  codeWord: "code",
  developerId: 1,
  ownerId: 1,
  coOwnerIds: [],
  seniorAdminIds: [],
  juniorAdminIds: [],
  adminIds: new Set([1]),
  inviteExpireHours: 24,
  databaseUrl: "",
  autoDeclineInvalidJoinRequests: true,
  reservationExpireCheckHours: 3,
  mainChatMemberLimit: 60,
  telegramApiRoot: "https://api.telegram.org",
  telegramProxyUrl: undefined,
  launchRetrySeconds: 15,
  rateLimitWindowSeconds: 5,
  rateLimitMaxUpdates: 15,
  maxApplicationsPerDay: 5,
  maxJoinsBeforeBan: 3,
} satisfies AppConfig;

type FakeTelegram = {
  created: Array<Record<string, unknown>>;
  revoked: string[];
  declined: number[];
  sent: Array<{ chatId: number; text: string }>;
  createChatInviteLink(chatId: number, options: Record<string, unknown>): Promise<{ invite_link: string }>;
  revokeChatInviteLink(chatId: number, inviteLink: string): Promise<void>;
  declineChatJoinRequest(chatId: number, userId: number): Promise<void>;
  sendMessage(chatId: number, text: string): Promise<{ message_id: number }>;
};

function createFakeBot() {
  let sequence = 0;
  const telegram: FakeTelegram = {
    created: [],
    revoked: [],
    declined: [],
    sent: [],
    async createChatInviteLink(chatId, options) {
      this.created.push({ chatId, ...options });
      await Promise.resolve();
      sequence += 1;
      return { invite_link: `https://t.me/+invite-${sequence}` };
    },
    async revokeChatInviteLink(_chatId, inviteLink) {
      this.revoked.push(inviteLink);
    },
    async declineChatJoinRequest(_chatId, userId) {
      this.declined.push(userId);
    },
    async sendMessage(chatId, text) {
      this.sent.push({ chatId, text });
      return { message_id: this.sent.length };
    },
  };
  return { bot: { telegram, on() {} } as unknown as Telegraf<BotContext>, telegram };
}

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hellscape-join-bot-"));
  const database = new Database(path.join(directory, "test.sqlite"));
  const repos = new Repositories(database);
  return {
    repos,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createApprovedReservation(repos: Repositories, telegramId: number, kind: ReservationKind) {
  const user = repos.upsertUser({ telegramId, username: `user${telegramId}` });
  const reservation = repos.createReservation({
    userId: user.id,
    roleName: kind === "waitlist" ? "Waitlist Role" : "Scheduled Role",
    usernameText: `@user${telegramId}`,
    codeWordEntered: "code",
    codeWordValid: true,
    reserveUntil: "2099-01-01T00:00:00.000Z",
    reservationKind: kind,
  });
  repos.updateReservationStatus(reservation.id, "approved", 1);
  return { user, reservation: repos.getReservationById(reservation.id)! };
}

test("scheduled and waitlist reservations receive tracked join-request links", async () => {
  const fixture = createFixture();
  try {
    const { bot, telegram } = createFakeBot();
    for (const [index, kind] of (["scheduled", "waitlist"] as const).entries()) {
      const { user, reservation } = createApprovedReservation(fixture.repos, 100 + index, kind);
      const result = await issueJoinRequestInvite(bot, fixture.repos, config, {
        reservationId: reservation.id,
        userId: user.id,
        name: `res-${reservation.id}-u-${user.telegram_id}`,
      });

      assert.equal(result.created, true);
      assert.equal(result.invite.application_id, null);
      assert.equal(result.invite.reservation_id, reservation.id);
      assert.equal(telegram.created[index]?.creates_join_request, true);
      assert.equal("member_limit" in telegram.created[index]!, false);
      assert.ok(new Date(result.invite.expires_at).getTime() > Date.now());
    }
  } finally {
    fixture.close();
  }
});

test("application links keep the same tracked join-request contract", async () => {
  const fixture = createFixture();
  try {
    const user = fixture.repos.upsertUser({ telegramId: 150, username: "user150" });
    const application = fixture.repos.createApplication({
      userId: user.id,
      role: "Role",
      usernameText: "@user150",
      codeWordEntered: "code",
      codeWordValid: true,
      aboutText: "",
      lifeChannelSubscribed: true,
      infoChannelSubscribed: true,
    });
    const { bot, telegram } = createFakeBot();
    const result = await issueJoinRequestInvite(bot, fixture.repos, config, {
      applicationId: application.id,
      userId: user.id,
      name: `app-${application.id}-u-${user.telegram_id}`,
    });

    assert.equal(result.invite.application_id, application.id);
    assert.equal(result.invite.reservation_id, null);
    assert.equal(telegram.created[0]?.creates_join_request, true);
    assert.equal("member_limit" in telegram.created[0]!, false);
  } finally {
    fixture.close();
  }
});

test("concurrent confirmation persists one link and revokes the orphan", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 200, "scheduled");
    const { bot, telegram } = createFakeBot();
    const input = { reservationId: reservation.id, userId: user.id, name: "race" };
    const [first, second] = await Promise.all([
      issueJoinRequestInvite(bot, fixture.repos, config, input),
      issueJoinRequestInvite(bot, fixture.repos, config, input),
    ]);

    assert.equal(first.invite.id, second.invite.id);
    assert.equal([first.created, second.created].filter(Boolean).length, 1);
    assert.equal(telegram.created.length, 2);
    assert.equal(telegram.revoked.length, 1);
  } finally {
    fixture.close();
  }
});

test("a valid reservation request consumes the personal link and completes on join", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 300, "waitlist");
    fixture.repos.markWaitlistNotified(reservation.id);
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "valid",
    });
    let queueChecks = 0;
    const subscriptions = { check: async () => ({ life: true, info: true }) };
    const forms = { checkWaitlistQueue: async () => { queueChecks += 1; } };
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      subscriptions as never,
      forms as never,
      () => config,
    );

    await (handlers as never as { handle(ctx: BotContext): Promise<void> }).handle({
      chatJoinRequest: {
        chat: { id: config.mainChatId },
        from: { id: user.telegram_id, first_name: "User", username: "user300" },
        invite_link: { invite_link: issued.invite.invite_link },
      },
    } as BotContext);

    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "pending");
    const request = fixture.repos.getJoinRequestById(1)!;
    assert.equal(request.application_id, null);
    assert.equal(request.reservation_id, reservation.id);
    assert.equal(telegram.declined.length, 0);

    await (handlers as never as { handleChatMember(ctx: BotContext): Promise<void> }).handleChatMember({
      chatMember: {
        chat: { id: config.mainChatId },
        old_chat_member: { status: "left", user: { id: user.telegram_id } },
        new_chat_member: { status: "member", user: { id: user.telegram_id } },
        invite_link: { invite_link: issued.invite.invite_link },
      },
    } as BotContext);

    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "used");
    assert.equal(fixture.repos.getReservationById(reservation.id)?.status, "used");
    assert.equal(fixture.repos.getUserById(user.id)?.bot_join_count, 1);
    assert.equal(queueChecks, 1);
    assert.ok(telegram.revoked.includes(issued.invite.invite_link));
  } finally {
    fixture.close();
  }
});

test("a shared reservation link is declined, revoked, and releases waitlist", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 400, "waitlist");
    fixture.repos.markWaitlistNotified(reservation.id);
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "shared",
    });
    let queueChecks = 0;
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => { queueChecks += 1; } } as never,
      () => config,
    );

    await (handlers as never as { handle(ctx: BotContext): Promise<void> }).handle({
      chatJoinRequest: {
        chat: { id: config.mainChatId },
        from: { id: 401, first_name: "Intruder", username: "intruder" },
        invite_link: { invite_link: issued.invite.invite_link },
      },
    } as BotContext);

    assert.deepEqual(telegram.declined, [401]);
    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "revoked");
    assert.equal(fixture.repos.getReservationById(reservation.id)?.status, "expired");
    assert.equal(queueChecks, 1);
  } finally {
    fixture.close();
  }
});

test("an expired reservation link closes the reservation and releases waitlist", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 500, "waitlist");
    fixture.repos.markWaitlistNotified(reservation.id);
    const invite = fixture.repos.createInviteLink({
      reservationId: reservation.id,
      userId: user.id,
      inviteLink: "https://t.me/+expired",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    fixture.repos.setInviteLinkStatus(invite.id, "pending");
    const { bot, telegram } = createFakeBot();

    const result = await expireTrackedInviteLinks(bot, fixture.repos, config);

    assert.equal(result.expired.length, 1);
    assert.equal(result.releasedWaitlist, true);
    assert.equal(fixture.repos.getInviteLinkById(invite.id)?.status, "expired");
    assert.equal(fixture.repos.getReservationById(reservation.id)?.status, "expired");
    assert.deepEqual(telegram.revoked, [invite.invite_link]);
  } finally {
    fixture.close();
  }
});

function callHandle(handlers: JoinRequestHandlers, opts: { chatId: number; from: Record<string, unknown>; inviteLink: string }) {
  return (handlers as never as { handle(ctx: BotContext): Promise<void> }).handle({
    chatJoinRequest: {
      chat: { id: opts.chatId },
      from: opts.from,
      invite_link: { invite_link: opts.inviteLink },
    },
  } as BotContext);
}

test("duplicate owner join request is ignored, not declined", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 700, "scheduled");
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "dup",
    });
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    const from = { id: user.telegram_id, first_name: "User", username: "user700" };
    await callHandle(handlers, { chatId: config.mainChatId, from, inviteLink: issued.invite.invite_link });
    // Telegram redelivers the same update (at-least-once).
    await callHandle(handlers, { chatId: config.mainChatId, from, inviteLink: issued.invite.invite_link });

    assert.equal(telegram.declined.length, 0);
    assert.equal(telegram.revoked.length, 0);
    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "pending");
    // Exactly one pending join request was created; the duplicate added nothing.
    assert.ok(fixture.repos.getJoinRequestById(1));
    assert.equal(fixture.repos.getJoinRequestById(2), undefined);
    assert.equal(fixture.repos.getReservationById(reservation.id)?.status, "approved");
  } finally {
    fixture.close();
  }
});

test("owner request after join is used is ignored", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 750, "scheduled");
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "used",
    });
    fixture.repos.setInviteLinkStatus(issued.invite.id, "used");
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    await callHandle(handlers, {
      chatId: config.mainChatId,
      from: { id: user.telegram_id, first_name: "User", username: "user750" },
      inviteLink: issued.invite.invite_link,
    });

    assert.equal(telegram.declined.length, 0);
    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "used");
    assert.equal(fixture.repos.getJoinRequestById(1), undefined);
  } finally {
    fixture.close();
  }
});

test("owner request on a revoked link is declined and the owner is told to reapply", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 800, "scheduled");
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "revoked",
    });
    fixture.repos.setInviteLinkStatus(issued.invite.id, "revoked");
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    await callHandle(handlers, {
      chatId: config.mainChatId,
      from: { id: user.telegram_id, first_name: "User", username: "user800" },
      inviteLink: issued.invite.invite_link,
    });

    assert.deepEqual(telegram.declined, [user.telegram_id]);
    assert.ok(telegram.sent.some((message) => message.chatId === user.telegram_id));
    assert.equal(telegram.revoked.length, 0);
  } finally {
    fixture.close();
  }
});

test("ban and lost subscriptions invalidate reservation links", async () => {
  const fixture = createFixture();
  try {
    const banned = createApprovedReservation(fixture.repos, 600, "scheduled");
    const unsubscribed = createApprovedReservation(fixture.repos, 601, "scheduled");
    const { bot, telegram } = createFakeBot();
    const bannedInvite = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: banned.reservation.id,
      userId: banned.user.id,
      name: "banned",
    });
    const unsubscribedInvite = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: unsubscribed.reservation.id,
      userId: unsubscribed.user.id,
      name: "unsubscribed",
    });
    fixture.repos.setUserBanned(banned.user.telegram_id, true, "manual");

    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async (userId: number) => ({ life: userId !== 601, info: userId !== 601 }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    for (const entry of [
      { user: banned.user, invite: bannedInvite.invite },
      { user: unsubscribed.user, invite: unsubscribedInvite.invite },
    ]) {
      await (handlers as never as { handle(ctx: BotContext): Promise<void> }).handle({
        chatJoinRequest: {
          chat: { id: config.mainChatId },
          from: { id: entry.user.telegram_id, first_name: "User", username: `user${entry.user.telegram_id}` },
          invite_link: { invite_link: entry.invite.invite_link },
        },
      } as BotContext);
    }

    assert.deepEqual(telegram.declined, [600, 601]);
    assert.equal(fixture.repos.getInviteLinkById(bannedInvite.invite.id)?.status, "revoked");
    assert.equal(fixture.repos.getInviteLinkById(unsubscribedInvite.invite.id)?.status, "revoked");
    assert.equal(fixture.repos.getReservationById(banned.reservation.id)?.status, "expired");
    assert.equal(fixture.repos.getReservationById(unsubscribed.reservation.id)?.status, "expired");
  } finally {
    fixture.close();
  }
});

test("join request via a link the bot never created is ignored entirely", async () => {
  const fixture = createFixture();
  try {
    const { bot, telegram } = createFakeBot();
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    await callHandle(handlers, {
      chatId: config.mainChatId,
      from: { id: 900, first_name: "Owner", username: "owner_invited" },
      inviteLink: "https://t.me/+manually-created-by-owner",
    });

    assert.equal(telegram.declined.length, 0);
    assert.equal(telegram.revoked.length, 0);
    assert.equal(telegram.sent.length, 0);
  } finally {
    fixture.close();
  }
});

test("owner join request on a leaked link bans the link owner from applications", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 900, "scheduled");
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "leaked",
    });
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    await callHandle(handlers, {
      chatId: config.mainChatId,
      from: { id: 901, first_name: "Intruder", username: "intruder901" },
      inviteLink: issued.invite.invite_link,
    });

    assert.deepEqual(telegram.declined, [901]);
    assert.equal(fixture.repos.getUserById(user.id)?.is_banned, 1);
    assert.ok(telegram.sent.some((message) => message.text.includes("Слив персональной ссылки")));
  } finally {
    fixture.close();
  }
});

test("someone else actually joining via a leaked link bans the link owner from applications", async () => {
  const fixture = createFixture();
  try {
    const { user, reservation } = createApprovedReservation(fixture.repos, 950, "scheduled");
    const { bot, telegram } = createFakeBot();
    const issued = await issueJoinRequestInvite(bot, fixture.repos, config, {
      reservationId: reservation.id,
      userId: user.id,
      name: "leaked-join",
    });
    const handlers = new JoinRequestHandlers(
      bot,
      fixture.repos,
      { check: async () => ({ life: true, info: true }) } as never,
      { checkWaitlistQueue: async () => {} } as never,
      () => config,
    );

    await (handlers as never as { handleChatMember(ctx: BotContext): Promise<void> }).handleChatMember({
      chatMember: {
        chat: { id: config.mainChatId },
        old_chat_member: { status: "left", user: { id: 951 } },
        new_chat_member: { status: "member", user: { id: 951 } },
        invite_link: { invite_link: issued.invite.invite_link },
      },
    } as BotContext);

    assert.equal(fixture.repos.getInviteLinkById(issued.invite.id)?.status, "revoked");
    assert.equal(fixture.repos.getUserById(user.id)?.is_banned, 1);
    assert.ok(telegram.sent.some((message) => message.text.includes("Нарушена персональность ссылки")));
    assert.ok(telegram.sent.some((message) => message.text.includes("Слив персональной ссылки")));
  } finally {
    fixture.close();
  }
});
