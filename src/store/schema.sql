CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,
  rng_seed INTEGER NOT NULL,
  roll_counter INTEGER NOT NULL,
  name_lists TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  parent_place_id TEXT,
  culture_id TEXT
);

CREATE TABLE IF NOT EXISTS wards (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  rating INTEGER NOT NULL,
  key_holder_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS factions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  power INTEGER NOT NULL,
  cohesion INTEGER NOT NULL,
  dominion INTEGER NOT NULL,
  origin TEXT NOT NULL,
  behavior TEXT NOT NULL,
  control TEXT NOT NULL,
  auto_intervene INTEGER NOT NULL,
  status TEXT NOT NULL,
  patron_godbound_id TEXT,
  contested_control INTEGER NOT NULL DEFAULT 0,
  home_place_id TEXT,
  harshness TEXT,
  cult INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  faction_id TEXT NOT NULL REFERENCES factions(id),
  text TEXT NOT NULL,
  domain TEXT NOT NULL,
  size TEXT NOT NULL,
  quality TEXT NOT NULL,
  magical INTEGER NOT NULL,
  origin TEXT NOT NULL,
  aimed_at_faction_id TEXT,
  covert INTEGER NOT NULL DEFAULT 0,
  maintained INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS feature_parts (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL REFERENCES features(id),
  text TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  faction_id TEXT NOT NULL REFERENCES factions(id),
  text TEXT NOT NULL,
  points INTEGER NOT NULL,
  domain TEXT NOT NULL,
  intrinsic INTEGER NOT NULL,
  external INTEGER NOT NULL,
  resistance INTEGER NOT NULL,
  face_character_id TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interests (
  id TEXT PRIMARY KEY,
  from_faction_id TEXT NOT NULL REFERENCES factions(id),
  to_faction_id TEXT NOT NULL REFERENCES factions(id),
  points INTEGER NOT NULL,
  nature TEXT NOT NULL,
  UNIQUE(from_faction_id, to_faction_id)
);

CREATE TABLE IF NOT EXISTS courts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  type TEXT NOT NULL,
  power_structure TEXT NOT NULL,
  atmosphere TEXT NOT NULL,
  place_id TEXT,
  rules_faction_id TEXT,
  blank INTEGER NOT NULL,
  acts_on_own INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT,
  role TEXT NOT NULL,
  court_id TEXT,
  faction_id TEXT,
  problem_id TEXT,
  power_source TEXT,
  side TEXT NOT NULL,
  is_leader INTEGER NOT NULL,
  is_hidden_controller INTEGER NOT NULL,
  shares_authority INTEGER NOT NULL,
  minor_relationship TEXT,
  stat_note TEXT,
  acts_on_own INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS court_memberships (
  court_id TEXT NOT NULL REFERENCES courts(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  rank TEXT NOT NULL,
  side TEXT NOT NULL,
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_hidden_controller INTEGER NOT NULL DEFAULT 0,
  shares_authority INTEGER NOT NULL DEFAULT 0,
  minor_relationship TEXT,
  PRIMARY KEY (court_id, character_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  text TEXT NOT NULL,
  fitted_summary TEXT,
  protagonist_id TEXT,
  antagonist_id TEXT
);

CREATE TABLE IF NOT EXISTS court_consequences (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  text TEXT NOT NULL,
  stat_note TEXT
);

CREATE TABLE IF NOT EXISTS court_defenses (
  id TEXT PRIMARY KEY,
  court_id TEXT NOT NULL REFERENCES courts(id),
  text TEXT NOT NULL,
  stat_note TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  subject TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  statement TEXT,
  kind TEXT NOT NULL,
  source_change_id TEXT,
  superseded_by TEXT,
  visibility TEXT NOT NULL DEFAULT 'public'
);

CREATE TABLE IF NOT EXISTS godbound (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  words TEXT NOT NULL DEFAULT '[]',
  influence INTEGER NOT NULL,
  dominion INTEGER NOT NULL,
  wealth INTEGER NOT NULL,
  divinity TEXT NOT NULL,
  cult_faction_id TEXT,
  acts_on_own INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  scope TEXT NOT NULL,
  magnitude TEXT NOT NULL,
  kind TEXT NOT NULL,
  place_ids TEXT NOT NULL DEFAULT '[]',
  faction_id TEXT,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  dominion_spent INTEGER NOT NULL DEFAULT 0,
  deeds_required INTEGER NOT NULL DEFAULT 0,
  deeds_done INTEGER NOT NULL DEFAULT 0,
  challenges_required INTEGER NOT NULL DEFAULT 0,
  challenges_done INTEGER NOT NULL DEFAULT 0,
  feature_id TEXT,
  backlash_problem_id TEXT
);

CREATE TABLE IF NOT EXISTS change_commitments (
  change_id TEXT NOT NULL REFERENCES changes(id),
  godbound_id TEXT NOT NULL REFERENCES godbound(id),
  influence INTEGER NOT NULL,
  wealth_spent INTEGER NOT NULL,
  PRIMARY KEY (change_id, godbound_id)
);

CREATE TABLE IF NOT EXISTS resisters (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id),
  rating INTEGER NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  change_id TEXT NOT NULL REFERENCES changes(id),
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setpieces (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  key TEXT NOT NULL,
  need TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(campaign_id, key)
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  month INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  open INTEGER NOT NULL,
  faction_order TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_views (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id),
  unit_type TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  UNIQUE(turn_id, unit_type, unit_id)
);

CREATE TABLE IF NOT EXISTS write_queue (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id),
  unit_type TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rolls (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  turn_id TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id),
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  feature_ids TEXT NOT NULL DEFAULT '[]',
  roll_id TEXT REFERENCES rolls(id),
  outcome TEXT,
  dominion_delta INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  turn_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
