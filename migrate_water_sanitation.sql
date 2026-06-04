-- Migration: add fill_delivered transaction type for two-step sanitation workflow
-- Run after migrate_water_cubes.sql.
--
-- fill_delivered = truck confirmed water delivery (was fill_confirmed)
-- fill_confirmed = sanitization confirmed after delivery (batch, post-run)
-- fill_flagged   = issue flagged on a delivered fill (unchanged)
--
-- The truck crew now scans cubes → fill_delivered, then batch-confirms sanitation
-- → fill_confirmed. The public cube status page shows the distinction.

SET NAMES utf8mb4;

ALTER TABLE transactions MODIFY COLUMN type ENUM(
    'checkout','checkin','sub_checkout','sub_checkin',
    'person_checkout','person_checkin',
    'used','activated','fill_confirmed','fill_flagged',
    'fill_requested','fill_adhoc','fill_cancelled','fill_delivered'
) NOT NULL;
