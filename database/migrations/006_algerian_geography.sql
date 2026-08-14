CREATE TABLE IF NOT EXISTS wilayas (
  id smallint PRIMARY KEY,
  name text NOT NULL,
  ar_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dairas (
  id integer PRIMARY KEY,
  wilaya_id smallint NOT NULL REFERENCES wilayas(id),
  name text NOT NULL,
  ar_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS communes (
  id integer PRIMARY KEY,
  daira_id integer NOT NULL REFERENCES dairas(id),
  wilaya_id smallint NOT NULL REFERENCES wilayas(id),
  name text NOT NULL,
  ar_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE educational_institutions ADD COLUMN IF NOT EXISTS commune_id integer REFERENCES communes(id);
CREATE INDEX IF NOT EXISTS idx_dairas_wilaya ON dairas(wilaya_id);
CREATE INDEX IF NOT EXISTS idx_communes_daira ON communes(daira_id);
CREATE INDEX IF NOT EXISTS idx_institutions_commune ON educational_institutions(commune_id);
