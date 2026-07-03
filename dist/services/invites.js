import { addHours, toUnixSeconds } from "../utils/time.js";
import { safeRevokeInviteLink } from "./telegram.js";
export async function issueJoinRequestInvite(bot, repos, config, input) {
    const existing = getActiveInvite(repos, input);
    if (existing)
        return { invite: existing, created: false };
    const expiresAt = addHours(new Date(), config.inviteExpireHours);
    const telegramInvite = await bot.telegram.createChatInviteLink(config.mainChatId, {
        name: input.name,
        expire_date: toUnixSeconds(expiresAt),
        creates_join_request: true,
    });
    try {
        const invite = repos.createInviteLink({
            applicationId: input.applicationId,
            reservationId: input.reservationId,
            userId: input.userId,
            inviteLink: telegramInvite.invite_link,
            expiresAt: expiresAt.toISOString(),
        });
        return { invite, created: true };
    }
    catch (error) {
        // A concurrent callback may have won the unique active-link constraint.
        // Revoke this orphan before returning the already persisted personal link.
        await safeRevokeInviteLink(bot, config.mainChatId, telegramInvite.invite_link);
        const concurrent = getActiveInvite(repos, input);
        if (concurrent)
            return { invite: concurrent, created: false };
        throw error;
    }
}
export async function expireTrackedInviteLinks(bot, repos, config) {
    const expired = repos.expireOldInviteLinks();
    let releasedWaitlist = false;
    for (const invite of expired) {
        await safeRevokeInviteLink(bot, config.mainChatId, invite.invite_link);
        if (!invite.reservation_id)
            continue;
        const reservation = repos.getReservationById(invite.reservation_id);
        if (reservation?.status !== "approved")
            continue;
        repos.updateReservationStatus(reservation.id, "expired", null, "Срок персональной ссылки истёк");
        if (reservation.reservation_kind === "waitlist")
            releasedWaitlist = true;
    }
    return { expired, releasedWaitlist };
}
function getActiveInvite(repos, source) {
    return source.applicationId !== undefined
        ? repos.getActiveInviteLinkByApplicationId(source.applicationId)
        : repos.getActiveInviteLinkByReservationId(source.reservationId);
}
