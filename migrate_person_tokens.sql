-- Person Badge QR Pool migration
-- Run after: migrate_borrow_restrictions.sql
-- Adds: person_tokens table, makes username/password_hash nullable, adds 'person' role

-- Make username nullable (person accounts have no username)
ALTER TABLE users MODIFY COLUMN username VARCHAR(64) NULL;

-- Make password_hash nullable (person accounts have no password initially)
ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;

-- Add 'person' to role ENUM
ALTER TABLE users MODIFY COLUMN role
    ENUM('production_admin','production_staff','dept_admin','dept_staff',
         'person','admin','staff','validator')
    NOT NULL DEFAULT 'dept_staff';

-- Pre-generated badge QR pool
CREATE TABLE IF NOT EXISTS person_tokens (
    id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    token        VARCHAR(64)   NOT NULL,
    label        VARCHAR(64)   NULL,
    user_id      INT UNSIGNED  NULL,
    display_name VARCHAR(128)  NULL,
    claimed_at   DATETIME      NULL,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_token (token),
    KEY idx_user (user_id),
    CONSTRAINT fk_person_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
