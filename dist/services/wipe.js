import { safeRevokeInviteLink } from "./telegram.js";
export async function wipeDatabaseWithTelegram(bot, repos, getConfig) {
    const result = repos.wipeAllData();
    let revokedInviteLinks = 0;
    let failedInviteRevokes = 0;
    for (const invite of result.activeInviteLinks) {
        const revoked = await safeRevokeInviteLink(bot, getConfig().mainChatId, invite.invite_link);
        if (revoked)
            revokedInviteLinks += 1;
        else
            failedInviteRevokes += 1;
    }
    return {
        ...result,
        revokedInviteLinks,
        failedInviteRevokes,
    };
}
