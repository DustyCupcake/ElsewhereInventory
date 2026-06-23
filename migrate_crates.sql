-- migrate_crates.sql
-- Adds crate support: equipment types can be flagged as crates, which hold
-- unlabeled items described by a manifest (name + count + notes per line).

ALTER TABLE equipment_types
    ADD COLUMN is_crate               TINYINT(1)   NOT NULL DEFAULT 0   AFTER borrowable,
    ADD COLUMN deployment_destination VARCHAR(255)  NULL                 AFTER is_crate;

CREATE TABLE IF NOT EXISTS crate_manifest (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_id       INT UNSIGNED NOT NULL,
    content_name  VARCHAR(255) NOT NULL,
    quantity      SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    notes         VARCHAR(255) NULL,
    sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_crate_manifest_item (item_id),
    CONSTRAINT fk_crate_manifest_item FOREIGN KEY (item_id)
        REFERENCES equipment_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
