-- Data repair migration.
-- Run via: mysql -u user -p db < migrate_fix_barrio_visibility_and_status.sql
--
-- Fixes two bugs:
--   1. Barrios created after migrate_overhaul.sql never got dept_id set, so
--      dept-scoped staff (view_barrios permission without production-level
--      view_inventory) could not see them in GET /barrios.
--   2. Items sub-checked-out directly to a barrio/artist (dept -> barrio,
--      skipping a separate production -> dept checkout step) kept
--      status = 'available' because handle_sub_checkout never updated it,
--      so they showed the barrio name but still displayed as "available".

-- 1. Backfill barrios with no department assignment.
UPDATE barrios
SET dept_id = (SELECT id FROM departments WHERE sub_entity = 'barrio' ORDER BY id LIMIT 1)
WHERE dept_id IS NULL;

-- 2. Fix items that are actually lent out but still marked available.
UPDATE equipment_items
SET status = 'checked-out'
WHERE status = 'available'
  AND (current_barrio_id IS NOT NULL OR current_artist_id IS NOT NULL OR current_person_id IS NOT NULL);
