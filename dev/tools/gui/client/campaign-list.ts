export type CampaignOption = { id: string; name: string };

export function campaignOptionLabel(campaign: CampaignOption): string {
  return `${campaign.name} — ${campaign.id}`;
}

export function campaignMenuRows(campaigns: CampaignOption[]): { id: string; label: string }[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaignOptionLabel(campaign),
  }));
}
