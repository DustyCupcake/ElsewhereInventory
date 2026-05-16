-- ─── Person Checkout Migration ───────────────────────────────────────────────
-- Run after migrate_overhaul.sql
-- Adds: user QR tokens, person-level item tracking, person transaction types

-- QR token for each user (generated lazily on login if NULL)
ALTER TABLE users
  ADD COLUMN qr_token VARCHAR(64) NULL AFTER language,
  ADD UNIQUE KEY uq_user_qr_token (qr_token);

-- Track which person an item is checked out to
ALTER TABLE equipment_items
  ADD COLUMN current_person_id INT UNSIGNED NULL AFTER current_artist_id,
  ADD KEY idx_item_person (current_person_id),
  ADD CONSTRAINT fk_item_person
    FOREIGN KEY (current_person_id) REFERENCES users(id) ON DELETE SET NULL;

-- Track person in transaction log
ALTER TABLE transactions
  ADD COLUMN person_id INT UNSIGNED NULL AFTER artist_id,
  ADD KEY idx_trans_person (person_id);

-- Extend transaction type ENUM with person checkout/checkin
ALTER TABLE transactions MODIFY COLUMN type ENUM(
  'checkout','checkin',
  'sub_checkout','sub_checkin',
  'person_checkout','person_checkin',
  'used','activated','fill_confirmed','fill_flagged'
) NOT NULL;
