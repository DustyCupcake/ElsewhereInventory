-- Add scannable QR codes to barrios and departments
-- so they can be looked up via the unified /scan endpoint.
-- Run after migrate_borrow_restrictions.sql

ALTER TABLE barrios     ADD COLUMN qr_code VARCHAR(64) NULL UNIQUE AFTER name;
ALTER TABLE departments ADD COLUMN qr_code VARCHAR(64) NULL UNIQUE AFTER name;

-- Backfill stable codes for existing rows
UPDATE barrios     SET qr_code = CONCAT('B', LPAD(id, 6, '0')) WHERE qr_code IS NULL;
UPDATE departments SET qr_code = CONCAT('D', LPAD(id, 6, '0')) WHERE qr_code IS NULL;
