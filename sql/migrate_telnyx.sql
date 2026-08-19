-- Idempotent migration for existing HomeLine databases created before the
-- Telnyx provider change. Fresh installs already use the new column names.
SET @schema_name = DATABASE();

SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='listings' AND COLUMN_NAME='twilio_number');
SET @sql = IF(@has_old=1,
  'ALTER TABLE listings RENAME COLUMN twilio_number TO phone_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='listings' AND COLUMN_NAME='twilio_number_sid');
SET @sql = IF(@has_old=1,
  'ALTER TABLE listings RENAME COLUMN twilio_number_sid TO telnyx_number_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='listings' AND COLUMN_NAME='telnyx_order_id');
SET @sql = IF(@has_col=0,
  'ALTER TABLE listings ADD COLUMN telnyx_order_id VARCHAR(64) NULL AFTER telnyx_number_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='call_events' AND COLUMN_NAME='twilio_number');
SET @sql = IF(@has_old=1,
  'ALTER TABLE call_events RENAME COLUMN twilio_number TO phone_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='call_events' AND COLUMN_NAME='call_sid');
SET @sql = IF(@has_old=1,
  'ALTER TABLE call_events RENAME COLUMN call_sid TO call_control_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE call_events MODIFY COLUMN call_control_id VARCHAR(255) NULL;
