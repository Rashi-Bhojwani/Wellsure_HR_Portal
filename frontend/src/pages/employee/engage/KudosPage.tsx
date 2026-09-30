import { EngagePage } from "./EngagePage";

// "My Worklife > Kudos" — the same Engage feed, pre-filtered to Kudos
// activity, rather than a second, parallel kudos implementation. Give
// Kudos/react/comment all work identically here since it's the same page.
export function KudosPage() {
  return <EngagePage initialActivity="KUDOS" />;
}
