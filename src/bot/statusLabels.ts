import type { ApplicationStatus, InviteLinkStatus, JoinRequestStatus, ReservationStatus } from "../types.js";
import { escapeHtml } from "../utils/text.js";
import { applicationStatusText, inviteLinkStatusText, joinRequestStatusText, reservationStatusText } from "./texts.js";

export function applicationStatusLabel(status: ApplicationStatus, rejectReason?: string | null) {
  switch (status) {
    case "pending":
      return applicationStatusText.pending;
    case "approved":
      return applicationStatusText.approved;
    case "rejected":
      return `${applicationStatusText.rejected}${rejectReason ? `: ${rejectReason}` : ""}`;
    case "joined":
      return applicationStatusText.joined;
  }
}

export function applicationStatusHtml(status: ApplicationStatus, rejectReason?: string | null) {
  return escapeHtml(applicationStatusLabel(status, rejectReason));
}

export function reservationStatusLabel(status: ReservationStatus) {
  switch (status) {
    case "pending":
      return reservationStatusText.pending;
    case "approved":
      return reservationStatusText.approved;
    case "rejected":
      return reservationStatusText.rejected;
    case "expired":
      return reservationStatusText.expired;
    case "used":
      return reservationStatusText.used;
  }
}

export function joinRequestStatusLabel(status: JoinRequestStatus) {
  switch (status) {
    case "pending":
      return joinRequestStatusText.pending;
    case "approved":
      return joinRequestStatusText.approved;
    case "rejected":
      return joinRequestStatusText.rejected;
  }
}

export function inviteLinkStatusLabel(status: InviteLinkStatus) {
  switch (status) {
    case "active":
      return inviteLinkStatusText.active;
    case "used":
      return inviteLinkStatusText.used;
    case "revoked":
      return inviteLinkStatusText.revoked;
    case "expired":
      return inviteLinkStatusText.expired;
  }
}
