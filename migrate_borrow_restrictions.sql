-- ─── Equipment Borrowability & Restrictions Migration ─────────────────────────
-- Run after migrate_person_checkout.sql
-- Adds: borrowable flag on equipment types, flexible borrow restriction rules

-- Mark equipment types as available for personal checkout
ALTER TABLE equipment_types
  ADD COLUMN borrowable TINYINT(1) NOT NULL DEFAULT 0 AFTER order_deadline;

-- Allowlist rules: if ANY rules exist for a type/item, only those matching can borrow.
-- If no rules exist, any user with person_checkout permission can borrow.
-- Rules can restrict by dept or by individual user; both columns can be set on one row.
-- item_id rules take precedence over (and override) type-level rules for that item.
CREATE TABLE equipment_borrow_rules (
    id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    equipment_type_id INT UNSIGNED NULL REFERENCES equipment_types(id) ON DELETE CASCADE,
    item_id           INT UNSIGNED NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
    allowed_dept_id   INT UNSIGNED NULL REFERENCES departments(id)     ON DELETE CASCADE,
    allowed_user_id   INT UNSIGNED NULL REFERENCES users(id)           ON DELETE CASCADE,
    PRIMARY KEY (id),
    -- At least one of type/item and one of dept/user must be set
    KEY idx_type (equipment_type_id),
    KEY idx_item (item_id)
);
