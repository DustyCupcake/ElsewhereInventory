-- Migration: water cube fill request system
-- Run after migrate_storage_locations.sql.
-- Replaces the 2-QR voucher system with permanent cube QR + fill request workflow.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── equipment_items: route position for truck routing ────────────────────────
ALTER TABLE equipment_items
    ADD COLUMN IF NOT EXISTS route_position SMALLINT UNSIGNED NULL AFTER notes;

-- ─── transactions: add fill workflow types ────────────────────────────────────
-- fill_requested: logged when a fill request is created
-- fill_adhoc:     truck fills a cube without a digital request (sticker fallback)
-- fill_cancelled: logged when a fill request is cancelled
ALTER TABLE transactions MODIFY COLUMN type ENUM(
    'checkout','checkin','sub_checkout','sub_checkin',
    'person_checkout','person_checkin',
    'used','activated','fill_confirmed','fill_flagged',
    'fill_requested','fill_adhoc','fill_cancelled'
) NOT NULL;

-- ─── fill_requests: per-run fill requests feeding the truck route ─────────────
-- cube_item_id NULL  → barrio entity-level request (any of their cubes can be filled)
-- cube_item_id SET   → cube-specific request (NWP: specific cube at specific location)
CREATE TABLE IF NOT EXISTS fill_requests (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    entity_type      ENUM('barrio')    NOT NULL DEFAULT 'barrio',
    entity_id        INT UNSIGNED      NOT NULL,
    cube_item_id     INT UNSIGNED      NULL,
    fills_requested  TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    fills_completed  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    status           ENUM('pending','partial','filled','cancelled') NOT NULL DEFAULT 'pending',
    requested_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    requested_by     INT UNSIGNED      NULL,
    filled_at        DATETIME          NULL,
    filled_by        INT UNSIGNED      NULL,
    notes            TEXT              NULL,
    PRIMARY KEY (id),
    KEY idx_fr_entity  (entity_type, entity_id),
    KEY idx_fr_cube    (cube_item_id),
    KEY idx_fr_status  (status),
    CONSTRAINT fk_fr_cube     FOREIGN KEY (cube_item_id)  REFERENCES equipment_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_fr_barrio   FOREIGN KEY (entity_id)     REFERENCES barrios(id)         ON DELETE CASCADE,
    CONSTRAINT fk_fr_req_user FOREIGN KEY (requested_by)  REFERENCES users(id)           ON DELETE SET NULL,
    CONSTRAINT fk_fr_fil_user FOREIGN KEY (filled_by)     REFERENCES users(id)           ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── fill_run_claims: direction lock for concurrent truck shifts ─────────────
-- Each truck shift claims 'asc' or 'desc'. Claims expire after 12 h or on release.
-- Prevents both trucks from driving the same direction simultaneously.
CREATE TABLE IF NOT EXISTS fill_run_claims (
    id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    direction   ENUM('asc','desc') NOT NULL,
    user_name   VARCHAR(128)      NULL,
    user_id     INT UNSIGNED      NULL,
    claimed_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released    TINYINT(1)        NOT NULL DEFAULT 0,
    released_at DATETIME          NULL,
    PRIMARY KEY (id),
    KEY idx_frc_dir     (direction),
    KEY idx_frc_claimed (claimed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Seed: water fill consumable type ────────────────────────────────────────
INSERT IGNORE INTO consumable_types (name, key_name, sort_order)
VALUES ('Water Fill', 'water_fill', 10);

SET FOREIGN_KEY_CHECKS = 1;
