-- Migration: barrio locations and barrio-scoped shifts
-- Adds barrio_id to storage_locations (so locations can belong to a barrio)
-- Adds barrio_id to shifts (so shift sessions can be auto-scoped to a barrio)

ALTER TABLE storage_locations
  ADD COLUMN barrio_id INT UNSIGNED NULL AFTER id,
  ADD CONSTRAINT fk_loc_barrio FOREIGN KEY (barrio_id) REFERENCES barrios(id) ON DELETE SET NULL;

ALTER TABLE shifts
  ADD COLUMN barrio_id INT UNSIGNED NULL AFTER dept_id,
  ADD CONSTRAINT fk_shift_barrio FOREIGN KEY (barrio_id) REFERENCES barrios(id) ON DELETE SET NULL;
