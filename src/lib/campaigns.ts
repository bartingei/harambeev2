export type Category = "medical" | "education" | "community" | "other";

export type Donor = { name: string; amount: number; when: string };

export type CampaignUpdate = { id: string; content: string; when: string };

export type Campaign = {
  id: string;
  title: string;
  organizer: string;
  organizerPhoto: string;
  story: string;
  category: Category;
  goal: number;
  raised: number;
  daysLeft: number;
  deadline: string | null;
  status: "active" | "completed" | "cancelled";
  isExpired: boolean;
  isAcceptingDonations: boolean;
  decisionDeadline: string | null;
  canExtend: boolean;
  image: string;
  creatorId: string | null;
  latestUpdate: CampaignUpdate | null;
};

export type DashboardDonation = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  name: string;
  amount: number;
  message: string;
  when: string;
};

export type DashboardUpdate = CampaignUpdate & {
  campaignId: string;
  campaignTitle: string;
};

export type OrganizerDashboard = {
  organizerName: string;
  organizerPhoto: string;
  campaigns: (Campaign & { donorCount: number })[];
  donations: DashboardDonation[];
  updates: DashboardUpdate[];
  totalRaised: number;
  totalGoal: number;
};

export type CampaignDetail = Campaign & {
  donors: Donor[];
  updates: CampaignUpdate[];
  donorCount: number;
};

export const categoryLabel: Record<Category, string> = {
  medical: "Medical",
  education: "Education",
  community: "Community",
  other: "Other",
};

export function formatKES(n: number) {
  return "KES " + Math.round(n).toLocaleString("en-KE");
}

export function daysUntil(deadline: string | null): number {
  if (!deadline) return 0;
  const diff = deadlineEnd(deadline).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export function deadlineEnd(deadline: string): Date {
  return new Date(`${deadline}T20:59:59.999Z`);
}

export function campaignLifecycle(deadline: string | null, status: string) {
  const end = deadline ? deadlineEnd(deadline) : null;
  const expired = status === "active" && !!end && Date.now() > end.getTime();
  const decisionDeadline = expired
    ? new Date(end.getTime() + 48 * 60 * 60 * 1000).toISOString()
    : null;
  const canExtend = expired && !!decisionDeadline && Date.now() <= new Date(decisionDeadline).getTime();
  return {
    isExpired: expired,
    isAcceptingDonations: status === "active" && !expired,
    decisionDeadline,
    canExtend,
  };
}

export function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}
