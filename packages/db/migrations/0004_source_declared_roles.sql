-- A single URL can legitimately be supplied in more than one role (for example a Wikipedia
-- article entered both as a press release and as a website). Track each role independently
-- instead of letting the last write win, so qualification cannot silently lose information.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS declared_as_website boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declared_as_press boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declared_as_profile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declared_as_page boolean NOT NULL DEFAULT false;

-- Backfill from the primary supplied_kind for existing rows.
UPDATE sources SET declared_as_website = true WHERE supplied_kind IN
  ('personal_site','professional_site','portfolio_site','project_site','organization_site','author_page');
UPDATE sources SET declared_as_press = true WHERE supplied_kind IN ('press_release','news_article');
UPDATE sources SET declared_as_profile = true WHERE supplied_kind IN ('social_profile','professional_profile','creator_profile');
UPDATE sources SET declared_as_page = true WHERE supplied_kind IN ('public_page','portfolio_url','other');