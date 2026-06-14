-- Add GPS coordinates to storage locations and equipment items (e.g. water cubes).
-- storage_locations.latitude/longitude: fixed named spots (shelves, cages, depots).
-- equipment_items.latitude/longitude:   mobile assets like water cubes parked in the field.

ALTER TABLE storage_locations
  ADD COLUMN latitude  DECIMAL(10,7) NULL AFTER description,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude;

ALTER TABLE equipment_items
  ADD COLUMN latitude  DECIMAL(10,7) NULL AFTER route_position,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude;
