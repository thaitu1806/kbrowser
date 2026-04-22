/**
 * Application error codes.
 * Organized by domain: 1xxx profile, 2xxx fingerprint, 3xxx proxy,
 * 4xxx auth, 5xxx sync, 6xxx extension, 7xxx serialization, 8xxx RPA.
 */

export enum AppErrorCode {
  // Profile errors (1xxx)
  PROFILE_NOT_FOUND = 1001,
  PROFILE_ALREADY_OPEN = 1002,
  PROFILE_DATA_CORRUPTED = 1003,

  // Fingerprint errors (2xxx)
  INVALID_CPU_CORES = 2001,
  INVALID_RAM_SIZE = 2002,
  INCONSISTENT_FINGERPRINT = 2003,

  // Proxy errors (3xxx)
  PROXY_DEAD = 3001,
  PROXY_TIMEOUT = 3002,
  ROTATION_FAILED = 3003,
  PROVIDER_API_ERROR = 3004,

  // Auth errors (4xxx)
  INVALID_API_KEY = 4001,
  ACCESS_DENIED = 4002,
  ROLE_INSUFFICIENT = 4003,

  // Sync errors (5xxx)
  SYNC_CONFLICT = 5001,
  SYNC_NETWORK_ERROR = 5002,
  SYNC_ENCRYPTION_ERROR = 5003,

  // Extension errors (6xxx)
  INVALID_EXTENSION_FORMAT = 6001,
  EXTENSION_INSTALL_FAILED = 6002,

  // Serialization errors (7xxx)
  INVALID_JSON = 7001,
  MISSING_REQUIRED_FIELD = 7002,
  INVALID_FIELD_VALUE = 7003,

  // RPA errors (8xxx)
  RPA_ACTION_FAILED = 8001,
  RPA_SCRIPT_INVALID = 8002,
  RPA_TIMEOUT = 8003,
}
