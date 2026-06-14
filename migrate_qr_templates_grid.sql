-- Adds grid layout mode to qr_templates.
-- Run after migrate_qr_templates.sql.

ALTER TABLE qr_templates
    MODIFY COLUMN pdf_filename VARCHAR(256) NULL,
    ADD COLUMN layout_mode    ENUM('page','grid') NOT NULL DEFAULT 'page'  AFTER item_filter,
    ADD COLUMN tag_width_mm   FLOAT NULL                                    AFTER layout_mode,
    ADD COLUMN tag_height_mm  FLOAT NULL                                    AFTER tag_width_mm,
    ADD COLUMN page_cols      TINYINT UNSIGNED NOT NULL DEFAULT 1           AFTER tag_height_mm,
    ADD COLUMN page_rows      TINYINT UNSIGNED NOT NULL DEFAULT 1           AFTER page_cols,
    ADD COLUMN margin_mm      FLOAT NOT NULL DEFAULT 10                     AFTER page_rows,
    ADD COLUMN gap_mm         FLOAT NOT NULL DEFAULT 5                      AFTER margin_mm,
    ADD COLUMN page_width_mm  FLOAT NULL                                    AFTER gap_mm,
    ADD COLUMN page_height_mm FLOAT NULL                                    AFTER page_width_mm;
