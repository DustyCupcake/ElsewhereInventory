-- Barrio Support — database schema
-- MySQL 5.7+ / MariaDB 10.3+
-- Import via phpMyAdmin or: mysql -u user -p else_inventory < schema.sql
--
-- This file reflects the complete current schema including all migrations.
-- For upgrading an existing database, run the migrate_*.sql files instead.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    username      VARCHAR(64)     NOT NULL,
    display_name  VARCHAR(128)    NOT NULL,
    password_hash VARCHAR(255)    NOT NULL,
    role          ENUM('production_admin','production_staff','dept_admin','dept_staff','admin','staff','validator')
                                  NOT NULL DEFAULT 'dept_staff',
    language      VARCHAR(5)      NOT NULL DEFAULT 'en',
    qr_token      VARCHAR(64)     NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login    DATETIME,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE KEY uq_username    (username),
    UNIQUE KEY uq_user_qr_token (qr_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Departments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(128) NOT NULL,
    qr_code    VARCHAR(64)  NULL,
    slug       VARCHAR(64)  NOT NULL,
    sub_entity ENUM('barrio','artist','none') NOT NULL DEFAULT 'none',
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_active  TINYINT(1)   NOT NULL DEFAULT 1,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_slug    (slug),
    UNIQUE KEY uq_name    (name),
    UNIQUE KEY uq_qr_code (qr_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Barrios ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barrios (
    id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name             VARCHAR(128)  NOT NULL,
    qr_code          VARCHAR(64)   NULL,
    dept_id          INT UNSIGNED  NULL,
    sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    arrival_status   ENUM('expected','on-site','departed') NOT NULL DEFAULT 'expected',
    arrived_at       DATETIME      NULL,
    arrived_by       INT UNSIGNED  NULL,
    arrived_by_name  VARCHAR(128)  NULL,
    orientation_done TINYINT(1)    NOT NULL DEFAULT 0,
    departed_at      DATETIME      NULL,
    departed_by      INT UNSIGNED  NULL,
    departed_by_name VARCHAR(128)  NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_name    (name),
    UNIQUE KEY uq_qr_code (qr_code),
    KEY idx_arrival_status (arrival_status),
    KEY idx_barrio_dept    (dept_id),
    CONSTRAINT fk_barrio_dept        FOREIGN KEY (dept_id)    REFERENCES departments(id) ON DELETE SET NULL,
    CONSTRAINT fk_barrio_arrived_by  FOREIGN KEY (arrived_by)  REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_barrio_departed_by FOREIGN KEY (departed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    KEY idx_dept     (dept_id),
    KEY idx_assigned (assigned_staff_id),
    CONSTRAINT fk_artist_dept  FOREIGN KEY (dept_id)           REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_artist_staff FOREIGN KEY (assigned_staff_id) REFERENCES users(id)       ON DELETE SET NULL
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
    KEY idx_dept   (dept_id),
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

-- ─── User department roles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_dept_roles (
    user_id INT UNSIGNED NOT NULL,
    dept_id INT UNSIGNED NOT NULL,
    role    ENUM('dept_admin','dept_staff') NOT NULL DEFAULT 'dept_staff',
    PRIMARY KEY (user_id, dept_id),
    CONSTRAINT fk_udr_user FOREIGN KEY (user_id) REFERENCES users(id)       ON DELETE CASCADE,
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

-- ─── Consumable types ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumable_types (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(128) NOT NULL,
    key_name   VARCHAR(64)  NOT NULL,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_key  (key_name),
    UNIQUE KEY uq_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Barrio consumable entitlements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barrio_entitlements (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    barrio_id   INT UNSIGNED NOT NULL,
    type_id     INT UNSIGNED NOT NULL,
    purchased   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    distributed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_barrio_type (barrio_id, type_id),
    CONSTRAINT fk_ent_barrio FOREIGN KEY (barrio_id) REFERENCES barrios(id)         ON DELETE CASCADE,
    CONSTRAINT fk_ent_type   FOREIGN KEY (type_id)   REFERENCES consumable_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Distribution event log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS distribution_events (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    barrio_id       INT UNSIGNED NOT NULL,
    type_id         INT UNSIGNED NOT NULL,
    quantity        SMALLINT     NOT NULL,
    performed_by    INT UNSIGNED,
    user_name_cache VARCHAR(128),
    occurred_at     DATETIME NOT NULL,
    notes           TEXT,
    PRIMARY KEY (id),
    KEY idx_barrio   (barrio_id),
    KEY idx_occurred (occurred_at),
    CONSTRAINT fk_dist_barrio FOREIGN KEY (barrio_id)    REFERENCES barrios(id),
    CONSTRAINT fk_dist_type   FOREIGN KEY (type_id)      REFERENCES consumable_types(id),
    CONSTRAINT fk_dist_user   FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Storage locations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage_locations (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    qr_code     VARCHAR(64)  NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_loc_qr (qr_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Equipment types ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_types (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                 VARCHAR(128) NOT NULL,
    category             VARCHAR(64),
    order_deadline       DATETIME     NULL,
    secure_qr            TINYINT(1)   NOT NULL DEFAULT 0,
    borrowable           TINYINT(1)   NOT NULL DEFAULT 0,
    home_location_id     INT UNSIGNED NULL,
    require_home_location TINYINT(1)  NOT NULL DEFAULT 0,
    require_any_location  TINYINT(1)  NOT NULL DEFAULT 0,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_name (name),
    CONSTRAINT fk_type_home_loc FOREIGN KEY (home_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Equipment items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_items (
    id                   INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    equipment_type_id    INT UNSIGNED      NOT NULL,
    item_number          SMALLINT UNSIGNED NOT NULL,
    qr_code              VARCHAR(128)      NOT NULL,
    status               ENUM('available','checked-out','activated','used','retired') NOT NULL DEFAULT 'available',
    current_dept_id      INT UNSIGNED      NULL,
    dept_label           VARCHAR(128)      NULL,
    current_barrio_id    INT UNSIGNED      NULL,
    current_artist_id    INT UNSIGNED      NULL,
    current_person_id    INT UNSIGNED      NULL,
    current_location_id  INT UNSIGNED      NULL,
    home_location_id     INT UNSIGNED      NULL,
    require_home_location TINYINT(1)       NULL,
    require_any_location  TINYINT(1)       NULL,
    notes                TEXT,
    created_at           DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_qr          (qr_code),
    UNIQUE KEY uq_type_number (equipment_type_id, item_number),
    KEY idx_status      (status),
    KEY idx_dept_item   (current_dept_id),
    KEY idx_barrio      (current_barrio_id),
    KEY idx_artist_item (current_artist_id),
    KEY idx_item_person (current_person_id),
    CONSTRAINT fk_item_type       FOREIGN KEY (equipment_type_id)   REFERENCES equipment_types(id),
    CONSTRAINT fk_item_dept       FOREIGN KEY (current_dept_id)     REFERENCES departments(id)       ON DELETE SET NULL,
    CONSTRAINT fk_item_barrio     FOREIGN KEY (current_barrio_id)   REFERENCES barrios(id)           ON DELETE SET NULL,
    CONSTRAINT fk_item_artist     FOREIGN KEY (current_artist_id)   REFERENCES artists(id)           ON DELETE SET NULL,
    CONSTRAINT fk_item_person     FOREIGN KEY (current_person_id)   REFERENCES users(id)             ON DELETE SET NULL,
    CONSTRAINT fk_item_cur_loc    FOREIGN KEY (current_location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_item_home_loc   FOREIGN KEY (home_location_id)    REFERENCES storage_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Barrio equipment orders ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barrio_equipment_orders (
    id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    barrio_id         INT UNSIGNED NOT NULL,
    equipment_type_id INT UNSIGNED NOT NULL,
    quantity_ordered  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_barrio_type (barrio_id, equipment_type_id),
    CONSTRAINT fk_eqord_barrio FOREIGN KEY (barrio_id)         REFERENCES barrios(id)         ON DELETE CASCADE,
    CONSTRAINT fk_eqord_type   FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id)
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
    CONSTRAINT fk_dord_dept FOREIGN KEY (dept_id)           REFERENCES departments(id)    ON DELETE CASCADE,
    CONSTRAINT fk_dord_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id),
    CONSTRAINT fk_dord_user FOREIGN KEY (submitted_by)      REFERENCES users(id)          ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Transactions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    type             ENUM('checkout','checkin','sub_checkout','sub_checkin','person_checkout','person_checkin','used','activated','fill_confirmed','fill_flagged') NOT NULL,
    item_id          INT UNSIGNED  NOT NULL,
    barrio_id        INT UNSIGNED  NULL,
    dept_id          INT UNSIGNED  NULL,
    artist_id        INT UNSIGNED  NULL,
    person_id        INT UNSIGNED  NULL,
    location_id      INT UNSIGNED  NULL,
    performed_by     INT UNSIGNED  NULL,
    user_name_cache  VARCHAR(128)  NULL,
    is_offline_entry TINYINT(1)    NOT NULL DEFAULT 0,
    occurred_at      DATETIME      NOT NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes            TEXT,
    PRIMARY KEY (id),
    KEY idx_item       (item_id),
    KEY idx_barrio     (barrio_id),
    KEY idx_txn_dept   (dept_id),
    KEY idx_txn_artist (artist_id),
    KEY idx_trans_person (person_id),
    KEY idx_occurred   (occurred_at),
    KEY idx_type       (type),
    CONSTRAINT fk_txn_item     FOREIGN KEY (item_id)      REFERENCES equipment_items(id),
    CONSTRAINT fk_txn_barrio   FOREIGN KEY (barrio_id)    REFERENCES barrios(id)           ON DELETE SET NULL,
    CONSTRAINT fk_txn_dept     FOREIGN KEY (dept_id)      REFERENCES departments(id)        ON DELETE SET NULL,
    CONSTRAINT fk_txn_artist   FOREIGN KEY (artist_id)    REFERENCES artists(id)            ON DELETE SET NULL,
    CONSTRAINT fk_txn_user     FOREIGN KEY (performed_by) REFERENCES users(id)              ON DELETE SET NULL,
    CONSTRAINT fk_txn_location FOREIGN KEY (location_id)  REFERENCES storage_locations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Equipment borrow rules ───────────────────────────────────────────────────
-- If ANY rules exist for a type/item, only matching users/depts can borrow.
-- If no rules exist, any user with person_checkout permission can borrow.
-- item_id rules take precedence over type-level rules for that item.
CREATE TABLE IF NOT EXISTS equipment_borrow_rules (
    id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    equipment_type_id INT UNSIGNED NULL,
    item_id           INT UNSIGNED NULL,
    allowed_dept_id   INT UNSIGNED NULL,
    allowed_user_id   INT UNSIGNED NULL,
    PRIMARY KEY (id),
    KEY idx_type (equipment_type_id),
    KEY idx_item (item_id),
    CONSTRAINT fk_brule_type FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id) ON DELETE CASCADE,
    CONSTRAINT fk_brule_item FOREIGN KEY (item_id)           REFERENCES equipment_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_brule_dept FOREIGN KEY (allowed_dept_id)   REFERENCES departments(id)     ON DELETE CASCADE,
    CONSTRAINT fk_brule_user FOREIGN KEY (allowed_user_id)   REFERENCES users(id)           ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
