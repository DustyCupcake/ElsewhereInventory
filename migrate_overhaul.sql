-- Major overhaul migration — event-wide equipment management
-- Run once: mysql -u user -p barrio_support < migrate_overhaul.sql
-- MySQL 5.7+ / MariaDB 10.3+

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── Departments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(128) NOT NULL,
    slug       VARCHAR(64)  NOT NULL,
    sub_entity ENUM('barrio','artist','none') NOT NULL DEFAULT 'none',
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_active  TINYINT(1)   NOT NULL DEFAULT 1,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_slug (slug),
    UNIQUE KEY uq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO departments (name, slug, sub_entity, sort_order)
VALUES ('Barrio Support', 'barrio_support', 'barrio', 0);

-- ─── Artists ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artists (
    id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    dept_id           INT UNSIGNED NOT NULL,
    name              VARCHAR(128) NOT NULL,
    assigned_staff_id INT UNSIGNED NULL,
    sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_dept_name (dept_id, name),
    KEY idx_dept (dept_id),
    KEY idx_assigned (assigned_staff_id),
    CONSTRAINT fk_artist_dept     FOREIGN KEY (dept_id)           REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_artist_staff    FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Shifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(128) NOT NULL,
    dept_id      INT UNSIGNED NULL,
    permissions  TEXT         NOT NULL,
    active_from  DATETIME     NOT NULL,
    active_until DATETIME     NOT NULL,
    created_by   INT UNSIGNED NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dept (dept_id),
    KEY idx_active (active_from, active_until),
    CONSTRAINT fk_shift_dept    FOREIGN KEY (dept_id)    REFERENCES departments(id) ON DELETE SET NULL,
    CONSTRAINT fk_shift_creator FOREIGN KEY (created_by) REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Shift tokens ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_tokens (
    id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    shift_id INT UNSIGNED NOT NULL,
    token    VARCHAR(64)  NOT NULL,
    label    VARCHAR(64)  NULL,
    used_at  DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_token (token),
    KEY idx_shift (shift_id),
    CONSTRAINT fk_stok_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── User dept roles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_dept_roles (
    user_id INT UNSIGNED NOT NULL,
    dept_id INT UNSIGNED NOT NULL,
    role    ENUM('dept_admin','dept_staff') NOT NULL DEFAULT 'dept_staff',
    PRIMARY KEY (user_id, dept_id),
    CONSTRAINT fk_udr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_udr_dept FOREIGN KEY (dept_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── User permission overrides ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id    INT UNSIGNED NOT NULL,
    permission VARCHAR(64)  NOT NULL,
    granted    TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, permission),
    CONSTRAINT fk_uperm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Invite tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_tokens (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    token      VARCHAR(64)  NOT NULL,
    role       ENUM('production_admin','production_staff','dept_admin','dept_staff') NOT NULL,
    dept_id    INT UNSIGNED NULL,
    use_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_by INT UNSIGNED NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_token (token),
    KEY idx_expires (expires_at),
    CONSTRAINT fk_itok_dept    FOREIGN KEY (dept_id)    REFERENCES departments(id) ON DELETE SET NULL,
    CONSTRAINT fk_itok_creator FOREIGN KEY (created_by) REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Department equipment orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dept_equipment_orders (
    id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    dept_id           INT UNSIGNED NOT NULL,
    equipment_type_id INT UNSIGNED NOT NULL,
    quantity_ordered  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    submitted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_by      INT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_dept_type (dept_id, equipment_type_id),
    CONSTRAINT fk_dord_dept FOREIGN KEY (dept_id)           REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_dord_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
    CONSTRAINT fk_dord_user FOREIGN KEY (submitted_by)      REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Modify users ─────────────────────────────────────────────────────────────
-- Expand role ENUM (language column already exists from migrate_user_language.sql)
ALTER TABLE users
  MODIFY COLUMN role ENUM(
    'production_admin','production_staff',
    'dept_admin','dept_staff',
    'admin','staff','validator'
  ) NOT NULL DEFAULT 'dept_staff';

-- ─── Modify equipment_types ───────────────────────────────────────────────────
ALTER TABLE equipment_types
  ADD COLUMN order_deadline DATETIME NULL;

-- ─── Modify equipment_items ───────────────────────────────────────────────────
ALTER TABLE equipment_items
  ADD COLUMN current_dept_id   INT UNSIGNED NULL AFTER status,
  ADD COLUMN dept_label        VARCHAR(128) NULL AFTER current_dept_id,
  ADD COLUMN current_artist_id INT UNSIGNED NULL AFTER current_barrio_id,
  ADD KEY idx_dept_item   (current_dept_id),
  ADD KEY idx_artist_item (current_artist_id),
  ADD CONSTRAINT fk_item_dept   FOREIGN KEY (current_dept_id)   REFERENCES departments(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_item_artist FOREIGN KEY (current_artist_id) REFERENCES artists(id)     ON DELETE SET NULL;

-- ─── Modify transactions ──────────────────────────────────────────────────────
ALTER TABLE transactions
  MODIFY type ENUM(
    'checkout','checkin',
    'sub_checkout','sub_checkin',
    'used','activated','fill_confirmed','fill_flagged'
  ) NOT NULL,
  ADD COLUMN dept_id   INT UNSIGNED NULL AFTER barrio_id,
  ADD COLUMN artist_id INT UNSIGNED NULL AFTER dept_id,
  ADD KEY idx_txn_dept   (dept_id),
  ADD KEY idx_txn_artist (artist_id),
  ADD CONSTRAINT fk_txn_dept   FOREIGN KEY (dept_id)   REFERENCES departments(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_txn_artist FOREIGN KEY (artist_id) REFERENCES artists(id)     ON DELETE SET NULL;

-- ─── Modify barrios ───────────────────────────────────────────────────────────
ALTER TABLE barrios
  ADD COLUMN dept_id INT UNSIGNED NULL AFTER name,
  ADD KEY idx_barrio_dept (dept_id),
  ADD CONSTRAINT fk_barrio_dept FOREIGN KEY (dept_id) REFERENCES departments(id) ON DELETE SET NULL;

-- Assign all existing barrios to Barrio Support department
UPDATE barrios SET dept_id = (SELECT id FROM departments WHERE slug = 'barrio_support')
WHERE dept_id IS NULL;

-- ─── Migrate existing user roles ──────────────────────────────────────────────
UPDATE users SET role = 'production_admin' WHERE role = 'admin';
UPDATE users SET role = 'production_staff' WHERE role = 'staff';
UPDATE users SET role = 'dept_staff'       WHERE role = 'validator';

-- Add barrio_support dept membership for existing staff/volunteers
INSERT IGNORE INTO user_dept_roles (user_id, dept_id, role)
SELECT u.id,
       (SELECT id FROM departments WHERE slug = 'barrio_support'),
       CASE WHEN u.role = 'production_staff' THEN 'dept_staff' ELSE 'dept_staff' END
FROM users u
WHERE u.role IN ('production_staff', 'dept_staff');

SET FOREIGN_KEY_CHECKS = 1;
