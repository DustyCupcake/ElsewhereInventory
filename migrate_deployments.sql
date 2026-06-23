SET NAMES utf8mb4;

-- ─── Named events ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(128) NOT NULL,
    event_date  DATE         NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_events_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Per-item per-event deployment record ─────────────────────────────────────
-- One row per item per event; logging the same item+event upserts in place.
CREATE TABLE IF NOT EXISTS item_deployments (
    id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    item_id     INT UNSIGNED  NOT NULL,
    event_id    INT UNSIGNED  NOT NULL,
    notes       TEXT          NULL,
    latitude    DECIMAL(10,7) NULL,
    longitude   DECIMAL(10,7) NULL,
    logged_by   INT UNSIGNED  NULL,
    logged_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_item_event (item_id, event_id),
    KEY idx_dep_item  (item_id),
    KEY idx_dep_event (event_id),
    CONSTRAINT fk_dep_item  FOREIGN KEY (item_id)  REFERENCES equipment_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_dep_event FOREIGN KEY (event_id) REFERENCES events(id)          ON DELETE CASCADE,
    CONSTRAINT fk_dep_user  FOREIGN KEY (logged_by) REFERENCES users(id)          ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Item photo gallery ───────────────────────────────────────────────────────
-- Multiple photos per item; optionally linked to a deployment record.
-- deployment_id NULL = general item photo not tied to a specific event.
CREATE TABLE IF NOT EXISTS item_photos (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_id       INT UNSIGNED NOT NULL,
    deployment_id INT UNSIGNED NULL,
    path          VARCHAR(255) NOT NULL,
    caption       VARCHAR(255) NULL,
    uploaded_by   INT UNSIGNED NULL,
    uploaded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_photo_item (item_id),
    KEY idx_photo_dep  (deployment_id),
    CONSTRAINT fk_photo_item FOREIGN KEY (item_id)       REFERENCES equipment_items(id)  ON DELETE CASCADE,
    CONSTRAINT fk_photo_dep  FOREIGN KEY (deployment_id) REFERENCES item_deployments(id) ON DELETE SET NULL,
    CONSTRAINT fk_photo_user FOREIGN KEY (uploaded_by)   REFERENCES users(id)            ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
