"use strict";
/**
 * Application error codes.
 * Organized by domain: 1xxx profile, 2xxx fingerprint, 3xxx proxy,
 * 4xxx auth, 5xxx sync, 6xxx extension, 7xxx serialization, 8xxx RPA.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppErrorCode = void 0;
var AppErrorCode;
(function (AppErrorCode) {
    // Profile errors (1xxx)
    AppErrorCode[AppErrorCode["PROFILE_NOT_FOUND"] = 1001] = "PROFILE_NOT_FOUND";
    AppErrorCode[AppErrorCode["PROFILE_ALREADY_OPEN"] = 1002] = "PROFILE_ALREADY_OPEN";
    AppErrorCode[AppErrorCode["PROFILE_DATA_CORRUPTED"] = 1003] = "PROFILE_DATA_CORRUPTED";
    // Fingerprint errors (2xxx)
    AppErrorCode[AppErrorCode["INVALID_CPU_CORES"] = 2001] = "INVALID_CPU_CORES";
    AppErrorCode[AppErrorCode["INVALID_RAM_SIZE"] = 2002] = "INVALID_RAM_SIZE";
    AppErrorCode[AppErrorCode["INCONSISTENT_FINGERPRINT"] = 2003] = "INCONSISTENT_FINGERPRINT";
    // Proxy errors (3xxx)
    AppErrorCode[AppErrorCode["PROXY_DEAD"] = 3001] = "PROXY_DEAD";
    AppErrorCode[AppErrorCode["PROXY_TIMEOUT"] = 3002] = "PROXY_TIMEOUT";
    AppErrorCode[AppErrorCode["ROTATION_FAILED"] = 3003] = "ROTATION_FAILED";
    AppErrorCode[AppErrorCode["PROVIDER_API_ERROR"] = 3004] = "PROVIDER_API_ERROR";
    // Auth errors (4xxx)
    AppErrorCode[AppErrorCode["INVALID_API_KEY"] = 4001] = "INVALID_API_KEY";
    AppErrorCode[AppErrorCode["ACCESS_DENIED"] = 4002] = "ACCESS_DENIED";
    AppErrorCode[AppErrorCode["ROLE_INSUFFICIENT"] = 4003] = "ROLE_INSUFFICIENT";
    // Sync errors (5xxx)
    AppErrorCode[AppErrorCode["SYNC_CONFLICT"] = 5001] = "SYNC_CONFLICT";
    AppErrorCode[AppErrorCode["SYNC_NETWORK_ERROR"] = 5002] = "SYNC_NETWORK_ERROR";
    AppErrorCode[AppErrorCode["SYNC_ENCRYPTION_ERROR"] = 5003] = "SYNC_ENCRYPTION_ERROR";
    // Extension errors (6xxx)
    AppErrorCode[AppErrorCode["INVALID_EXTENSION_FORMAT"] = 6001] = "INVALID_EXTENSION_FORMAT";
    AppErrorCode[AppErrorCode["EXTENSION_INSTALL_FAILED"] = 6002] = "EXTENSION_INSTALL_FAILED";
    // Serialization errors (7xxx)
    AppErrorCode[AppErrorCode["INVALID_JSON"] = 7001] = "INVALID_JSON";
    AppErrorCode[AppErrorCode["MISSING_REQUIRED_FIELD"] = 7002] = "MISSING_REQUIRED_FIELD";
    AppErrorCode[AppErrorCode["INVALID_FIELD_VALUE"] = 7003] = "INVALID_FIELD_VALUE";
    // RPA errors (8xxx)
    AppErrorCode[AppErrorCode["RPA_ACTION_FAILED"] = 8001] = "RPA_ACTION_FAILED";
    AppErrorCode[AppErrorCode["RPA_SCRIPT_INVALID"] = 8002] = "RPA_SCRIPT_INVALID";
    AppErrorCode[AppErrorCode["RPA_TIMEOUT"] = 8003] = "RPA_TIMEOUT";
})(AppErrorCode || (exports.AppErrorCode = AppErrorCode = {}));
//# sourceMappingURL=errors.js.map