-- Migration: storage locations, home locations, and location requirements
-- Run after all previous migrations.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── New: storage locations table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage_locations (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    qr_code     VARCHAR(64)  NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_loc_qr (qr_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── equipment_types: home location + return requirements ─────────────────────
ALTER TABLE equipment_types
    ADD COLUMN IF NOT EXISTS home_location_id      INT UNSIGNED NULL AFTER borrowable,
    ADD COLUMN IF NOT EXISTS require_home_location  TINYINT(1)  NOT NULL DEFAULT 0 AFTER home_location_id,
    ADD COLUMN IF NOT EXISTS require_any_location   TINYINT(1)  NOT NULL DEFAULT 0 AFTER require_home_location;

ALTER TABLE equipment_types
    DROP FOREIGN KEY IF EXISTS fk_type_home_loc;
ALTER TABLE equipment_types
    ADD CONSTRAINT fk_type_home_loc
        FOREIGN KEY (home_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL;

-- ─── equipment_items: per-item overrides + current location ───────────────────
ALTER TABLE equipment_items
    ADD COLUMN IF NOT EXISTS current_location_id   INT UNSIGNED NULL AFTER current_person_id,
    ADD COLUMN IF NOT EXISTS home_location_id       INT UNSIGNED NULL AFTER current_location_id,
    ADD COLUMN IF NOT EXISTS require_home_location  TINYINT(1)  NULL  AFTER home_location_id,
    ADD COLUMN IF NOT EXISTS require_any_location   TINYINT(1)  NULL  AFTER require_home_location;

ALTER TABLE equipment_items
    DROP FOREIGN KEY IF EXISTS fk_item_cur_loc;
ALTER TABLE equipment_items
    ADD CONSTRAINT fk_item_cur_loc
        FOREIGN KEY (current_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL;

ALTER TABLE equipment_items
    DROP FOREIGN KEY IF EXISTS fk_item_home_loc;
ALTER TABLE equipment_items
    ADD CONSTRAINT fk_item_home_loc
        FOREIGN KEY (home_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL;

-- ─── transactions: location recorded at checkin ───────────────────────────────
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS location_id INT UNSIGNED NULL AFTER person_id;

ALTER TABLE transactions
    DROP FOREIGN KEY IF EXISTS fk_txn_location;
ALTER TABLE transactions
    ADD CONSTRAINT fk_txn_location
        FOREIGN KEY (location_id) REFERENCES storage_locations(id) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
