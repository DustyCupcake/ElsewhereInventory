-- ─── QR Print Templates ──────────────────────────────────────────────────────
-- Stores PDF/image templates and zone definitions for QR label generation.

CREATE TABLE IF NOT EXISTS qr_templates (
    id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name          VARCHAR(128)  NOT NULL,
    pdf_filename  VARCHAR(256)  NOT NULL,
    item_filter   VARCHAR(64)   NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qr_template_zones (
    id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    template_id  INT UNSIGNED  NOT NULL,
    zone_type    ENUM('qr_code','item_number','item_name','custom_text') NOT NULL,
    page         TINYINT UNSIGNED NOT NULL DEFAULT 1,
    x_mm         FLOAT         NOT NULL,
    y_mm         FLOAT         NOT NULL,
    size_mm      FLOAT         NOT NULL,
    custom_value VARCHAR(256)  NULL,
    font_size    TINYINT UNSIGNED NOT NULL DEFAULT 12,
    PRIMARY KEY (id),
    KEY idx_ztpl (template_id),
    CONSTRAINT fk_zone_template FOREIGN KEY (template_id) REFERENCES qr_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
