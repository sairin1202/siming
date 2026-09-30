-- Matches the existing angel_devil_test tables. No existing data is replaced.
CREATE TABLE IF NOT EXISTS owners (
  id varchar(36) NOT NULL PRIMARY KEY,
  current_decision_id varchar(36) DEFAULT NULL,
  created_at datetime(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS browser_sessions (
  token_hash varchar(64) NOT NULL PRIMARY KEY,
  owner_id varchar(36) NOT NULL,
  expires_at datetime(6) NOT NULL,
  created_at datetime(6) NOT NULL,
  KEY ix_browser_sessions_expires_at (expires_at),
  KEY ix_browser_sessions_owner_id (owner_id),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS decisions (
  id varchar(36) NOT NULL PRIMARY KEY,
  owner_id varchar(36) NOT NULL,
  title text NOT NULL,
  verdict varchar(3) DEFAULT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  decided_at datetime(6) DEFAULT NULL,
  KEY ix_decisions_owner_updated (owner_id, updated_at),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS turns (
  id varchar(36) NOT NULL PRIMARY KEY,
  decision_id varchar(36) NOT NULL,
  position int NOT NULL,
  user_message text NOT NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE KEY uq_turn_position (decision_id, position),
  FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS replies (
  id varchar(36) NOT NULL PRIMARY KEY,
  turn_id varchar(36) NOT NULL,
  position int NOT NULL,
  role varchar(5) NOT NULL,
  content text NOT NULL,
  status varchar(10) NOT NULL,
  safety_mode varchar(12) DEFAULT NULL,
  error_message text,
  retryable tinyint(1) NOT NULL,
  generation_id varchar(36) DEFAULT NULL,
  started_at datetime(6) DEFAULT NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE KEY uq_reply_position (turn_id, position),
  FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
