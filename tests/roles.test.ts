import assert from "node:assert/strict";
import test from "node:test";
import {
  allRoleMatches,
  nextDashIndexAfter,
  normalizeRole,
  postPlainText,
  underlinedRoleNames,
  type RoleEntry,
} from "../src/services/roles.js";

function role(canonical: string, aliases: string[] = []): RoleEntry {
  return { canonical, aliases: [canonical, ...aliases], universe: "genshin" };
}

test("dash-boundary segment does not leak marker to preceding role when the next name is unrecognized", () => {
  // "Ч.лебедь" не входит в список ролей (алиас отсутствует) — маркер после неё
  // не должен попасть в статус "опал", которая идёт перед ней.
  const text = postPlainText(
    '<div class="tgme_widget_message_text js-message_text">опал - Ч.лебедь -<tg-emoji emoji-id="1"><i class="emoji"><b>🧪</b></i></tg-emoji> обсидиан -</div></div><div class="media_not_supported_cont">',
  );

  const roles = [role("опал"), role("обсидиан")];
  const matches = allRoleMatches(text, roles);

  const opal = matches.find((m) => m.key === normalizeRole("опал"))!;
  const nextDash = nextDashIndexAfter(text, opal.end);
  const segment = text.slice(opal.end, nextDash ?? text.length);

  assert.equal(segment.includes("🧪"), false, `opal segment must not contain leaked marker, got "${segment}"`);
});

test("dash-boundary segment still detects marker belonging to the role itself", () => {
  const text = postPlainText(
    '<div class="tgme_widget_message_text js-message_text">кли -<tg-emoji emoji-id="1"><i class="emoji"><b>🧪</b></i></tg-emoji> сянь юнь -</div></div><div class="media_not_supported_cont">',
  );

  const roles = [role("кли"), role("сянь юнь")];
  const matches = allRoleMatches(text, roles);

  const klee = matches.find((m) => m.key === normalizeRole("кли"))!;
  const nextDash = nextDashIndexAfter(text, klee.end);
  const segment = text.slice(klee.end, nextDash ?? text.length);

  assert.ok(segment.includes("🧪"), `klee segment must contain her own marker, got "${segment}"`);
});

test("alias with different punctuation still matches the post spelling", () => {
  const text = postPlainText(
    '<div class="tgme_widget_message_text js-message_text">мр.Река - эоны -</div></div><div class="media_not_supported_cont">',
  );

  const roleEntry = role("мистер река", ["мр. река", "мр река", "мр.река"]);
  const matches = allRoleMatches(text, [roleEntry]);
  const roleKeys = new Set(roleEntry.aliases.map(normalizeRole));

  assert.ok(matches.some((m) => roleKeys.has(m.key)), "мр.река alias should match post text");
});

test("underlinedRoleNames only scans the message body, not the whole page", () => {
  const html =
    '<html><body><u>сайдбар</u><div class="tgme_widget_message_text js-message_text"><u>кли</u></div></div><div class="media_not_supported_cont"></div></body></html>';

  const underlined = underlinedRoleNames(html);

  assert.ok(underlined.has(normalizeRole("кли")), "role underlined inside message body must be detected");
  assert.equal(underlined.has(normalizeRole("сайдбар")), false, "underline outside message body must be ignored");
});
