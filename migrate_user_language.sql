-- User language preference
-- Run once: mysql -u user -p barrio_support < migrate_user_language.sql

ALTER TABLE users
  ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT 'en'
  AFTER role;
