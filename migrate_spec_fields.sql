SET NAMES utf8mb4;

-- ─── Spec field definitions per equipment type ────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_type_spec_fields (
    id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    equipment_type_id INT UNSIGNED  NOT NULL,
    field_key         VARCHAR(64)   NOT NULL,
    label             VARCHAR(128)  NOT NULL,
    field_type        ENUM('number','text','boolean','select') NOT NULL DEFAULT 'text',
    unit              VARCHAR(32)   NULL,
    options           TEXT          NULL,
    sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_type_key (equipment_type_id, field_key),
    KEY idx_sf_type (equipment_type_id),
    CONSTRAINT fk_sf_type FOREIGN KEY (equipment_type_id)
        REFERENCES equipment_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Add spec values and photo to equipment items ─────────────────────────────
ALTER TABLE equipment_items
    ADD COLUMN spec_values TEXT NULL
        COMMENT 'JSON map of field_key -> value, e.g. {"input_16a": 4, "output_32a": 2}',
    ADD COLUMN photo VARCHAR(255) NULL
        COMMENT 'Relative path to item photo, e.g. storage/item_photos/42.jpg';
