import type { Context as TelegrafContext } from "telegraf";

export type ApplicationStatus = "pending" | "approved" | "rejected" | "joined";
export type InviteLinkStatus = "active" | "used" | "revoked" | "expired";
export type JoinRequestStatus = "pending" | "approved" | "rejected";
export type ReservationStatus = "pending" | "approved" | "rejected" | "expired" | "used";
export type ReservationKind = "scheduled" | "waitlist";

export type FormFlow =
  | "application"
  | "reservation"
  | "waitlist_reservation"
  | "extend_reservation"
  | "reject_application"
  | "reject_reservation";

export interface UserRecord {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_banned: number;
  ban_reason: string | null;
  bot_join_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicationRecord {
  id: number;
  user_id: number;
  role: string;
  username_text: string;
  code_word_entered: string;
  code_word_valid: number;
  about_text: string;
  life_channel_subscribed: number;
  info_channel_subscribed: number;
  status: ApplicationStatus;
  reviewed_by_admin_id: number | null;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface InviteLinkRecord {
  id: number;
  application_id: number;
  user_id: number;
  invite_link: string;
  status: InviteLinkStatus;
  expires_at: string;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface JoinRequestRecord {
  id: number;
  application_id: number | null;
  user_id: number | null;
  invite_link_id: number | null;
  status: JoinRequestStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_admin_id: number | null;
}

export interface RoleReservationRecord {
  id: number;
  user_id: number;
  role_name: string;
  username_text: string;
  code_word_entered: string;
  code_word_valid: number;
  reserve_until: string;
  reservation_kind: ReservationKind;
  status: ReservationStatus;
  reviewed_by_admin_id: number | null;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  reminder_sent_at: string | null;
  waitlist_notified_at: string | null;
  updated_at: string;
}

export interface UserStateRecord {
  telegram_id: number;
  flow: FormFlow;
  step: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionCheck {
  life: boolean;
  info: boolean;
}

export interface BotContext extends TelegrafContext {}
