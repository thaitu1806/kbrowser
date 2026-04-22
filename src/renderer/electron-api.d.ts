import type {
  ProfileConfig, Profile, ProfileSummary, BrowserConnection,
  ProxyConfig, Proxy, ProxyCheckResult,
  FingerprintConfig, FingerprintData, ValidationResult,
  Extension,
  RPAScript, RPAExecutionResult, RPATemplate,
  CreateUserRequest, User, Role, Permission, ProfileAction, AccessResult,
  ActionLogEntry, LogFilter,
} from '@shared/types';

interface ElectronAPI {
  platform: string;

  // Profiles
  listProfiles(): Promise<ProfileSummary[]>;
  getProfile(id: string): Promise<Profile | null>;
  createProfile(config: ProfileConfig): Promise<Profile>;
  openProfile(id: string): Promise<BrowserConnection>;
  onOpenStatus(callback: (data: { profileId: string; status: string; message: string }) => void): void;
  closeProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  updateProfile(id: string, config: Partial<ProfileConfig>): Promise<Profile>;

  // Proxies
  listProxies(): Promise<Proxy[]>;
  addProxy(config: ProxyConfig): Promise<Proxy>;
  removeProxy(id: string): Promise<void>;
  checkProxy(id: string): Promise<ProxyCheckResult>;
  checkProxyDirect(config: ProxyConfig, ipChecker?: string): Promise<{
    success: boolean;
    ip?: string;
    country?: string;
    region?: string;
    city?: string;
    responseTimeMs: number;
    error?: string;
  }>;
  assignProxy(proxyId: string, profileId: string): Promise<void>;
  validateProxy(profileId: string): Promise<{ status: string; proxy: Proxy | null; message: string }>;

  // Fingerprint
  generateFingerprint(config: FingerprintConfig): Promise<FingerprintData>;
  validateFingerprint(fpData: FingerprintData): Promise<ValidationResult>;

  // Extensions
  listExtensions(): Promise<Extension[]>;
  uploadExtension(fileData: number[], filename: string): Promise<Extension>;
  removeExtension(id: string): Promise<void>;
  assignExtension(extId: string, profileIds: string[]): Promise<void>;
  getExtensionsForProfile(profileId: string): Promise<Extension[]>;

  // RPA
  executeRPA(profileId: string, script: RPAScript): Promise<RPAExecutionResult>;
  saveRPAScript(script: RPAScript): Promise<string>;
  loadRPAScript(id: string): Promise<RPAScript>;
  listRPATemplates(platform?: string): Promise<RPATemplate[]>;
  loadRPATemplate(id: string): Promise<RPAScript>;

  // RBAC
  createUser(request: CreateUserRequest): Promise<User>;
  updateRole(userId: string, role: Role): Promise<void>;
  checkAccess(userId: string, profileId: string, action: ProfileAction): Promise<AccessResult>;
  shareProfile(profileId: string, targetUserId: string, permissions: Permission[]): Promise<void>;
  revokeAccess(profileId: string, targetUserId: string): Promise<void>;
  getUser(userId: string): Promise<User | null>;

  // Logs
  queryLogs(filter: LogFilter, callerRole?: Role, callerUserId?: string): Promise<ActionLogEntry[]>;
  cleanupLogs(): Promise<number>;

  // Serializer
  serializeProfile(config: ProfileConfig): Promise<string>;
  deserializeProfile(json: string): Promise<ProfileConfig>;
  validateProfileJSON(json: string): Promise<ValidationResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
