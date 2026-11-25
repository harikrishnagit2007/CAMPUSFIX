-- Add Firebase UID column
ALTER TABLE users
ADD COLUMN firebase_uid VARCHAR(128) NULL AFTER id;

-- Create unique index separately
CREATE UNIQUE INDEX idx_users_firebase_uid
ON users(firebase_uid);
