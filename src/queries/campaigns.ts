import type Database from "better-sqlite3";

export type CampaignListRow = { id: string; name: string };

export function getCampaigns(db: Database.Database): { campaigns: CampaignListRow[] } {
  const campaigns = db
    .prepare("SELECT id, name FROM campaigns ORDER BY name COLLATE NOCASE, id")
    .all() as CampaignListRow[];
  return { campaigns };
}
