-- Fill confirmation migration
-- Adds fill_confirmed and fill_flagged transaction types for post-fill audit records
-- Run once: mysql -u user -p barrio_support < migrate_fill_confirm.sql

ALTER TABLE transactions
  MODIFY type ENUM('checkout','checkin','used','activated','fill_confirmed','fill_flagged') NOT NULL;
