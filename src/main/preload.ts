import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes a safe API to the renderer process
 * via contextBridge. Each method maps to an ipcMain.handle() channel.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // ─── Profiles ───
  listProfiles: () => ipcRenderer.invoke('profile:list'),
  getProfile: (id: string) => ipcRenderer.invoke('profile:get', id),
  createProfile: (config: unknown) => ipcRenderer.invoke('profile:create', config),
  openProfile: (id: string) => ipcRenderer.invoke('profile:open', id),
  onOpenStatus: (callback: (data: { profileId: string; status: string; message: string }) => void) => {
    ipcRenderer.on('profile:open:status', (_event, data) => callback(data));
  },
  closeProfile: (id: string) => ipcRenderer.invoke('profile:close', id),
  deleteProfile: (id: string) => ipcRenderer.invoke('profile:delete', id),
  restoreProfile: (id: string) => ipcRenderer.invoke('profile:restore', id),
  permanentDeleteProfile: (id: string) => ipcRenderer.invoke('profile:permanentDelete', id),
  listDeletedProfiles: () => ipcRenderer.invoke('profile:listDeleted'),
  updateProfile: (id: string, config: unknown) => ipcRenderer.invoke('profile:update', id, config),
  getProfileCookies: (id: string) => ipcRenderer.invoke('profile:getCookies', id),
  getProfileTabs: (id: string) => ipcRenderer.invoke('profile:getTabs', id),
  saveProfileCookies: (id: string, cookieJson: string) => ipcRenderer.invoke('profile:saveCookies', id, cookieJson),
  saveExtendedData: (id: string, data: string) => ipcRenderer.invoke('profile:saveExtendedData', id, data),
  getExtendedData: (id: string) => ipcRenderer.invoke('profile:getExtendedData', id),

  // ─── Groups ───
  listGroups: () => ipcRenderer.invoke('group:list'),
  createGroup: (name: string, remark?: string) => ipcRenderer.invoke('group:create', name, remark),
  deleteGroup: (id: string) => ipcRenderer.invoke('group:delete', id),
  renameGroup: (id: string, name: string) => ipcRenderer.invoke('group:rename', id, name),

  // ─── Proxies ───
  listProxies: () => ipcRenderer.invoke('proxy:list'),
  addProxy: (config: unknown) => ipcRenderer.invoke('proxy:add', config),
  removeProxy: (id: string) => ipcRenderer.invoke('proxy:remove', id),
  checkProxy: (id: string) => ipcRenderer.invoke('proxy:check', id),
  checkProxyDirect: (config: unknown, ipChecker?: string) => ipcRenderer.invoke('proxy:checkDirect', config, ipChecker),
  updateProxyStatus: (proxyId: string, status: string, responseTimeMs: number) => ipcRenderer.invoke('proxy:updateStatus', proxyId, status, responseTimeMs),
  assignProxy: (proxyId: string, profileId: string) => ipcRenderer.invoke('proxy:assign', proxyId, profileId),
  validateProxy: (profileId: string) => ipcRenderer.invoke('proxy:validate', profileId),

  // ─── Fingerprint ───
  generateFingerprint: (config: unknown) => ipcRenderer.invoke('fingerprint:generate', config),
  validateFingerprint: (fpData: unknown) => ipcRenderer.invoke('fingerprint:validate', fpData),

  // ─── Extensions ───
  listExtensions: () => ipcRenderer.invoke('extension:list'),
  uploadExtension: (fileData: number[], filename: string) => ipcRenderer.invoke('extension:upload', fileData, filename),
  removeExtension: (id: string) => ipcRenderer.invoke('extension:remove', id),
  assignExtension: (extId: string, profileIds: string[]) => ipcRenderer.invoke('extension:assign', extId, profileIds),
  getExtensionsForProfile: (profileId: string) => ipcRenderer.invoke('extension:forProfile', profileId),

  // ─── RPA ───
  executeRPA: (profileId: string, script: unknown) => ipcRenderer.invoke('rpa:execute', profileId, script),
  saveRPAScript: (script: unknown) => ipcRenderer.invoke('rpa:save', script),
  loadRPAScript: (id: string) => ipcRenderer.invoke('rpa:load', id),
  listRPAScripts: () => ipcRenderer.invoke('rpa:list'),
  deleteRPAScript: (id: string) => ipcRenderer.invoke('rpa:delete', id),
  listRPATemplates: (platform?: string) => ipcRenderer.invoke('rpa:templates', platform),
  loadRPATemplate: (id: string) => ipcRenderer.invoke('rpa:loadTemplate', id),

  // ─── RPA Orchestrator ───
  rpaOrchestratorCreateTask: (profileId: string, scriptId: string, config: unknown) =>
    ipcRenderer.invoke('rpa-orchestrator:create-task', profileId, scriptId, config),
  rpaOrchestratorBatchExecute: (config: unknown) =>
    ipcRenderer.invoke('rpa-orchestrator:batch-execute', config),
  rpaOrchestratorCancelTask: (taskId: string) =>
    ipcRenderer.invoke('rpa-orchestrator:cancel-task', taskId),
  rpaOrchestratorCancelAll: (profileId: string) =>
    ipcRenderer.invoke('rpa-orchestrator:cancel-all', profileId),
  rpaOrchestratorGetQueue: (profileId: string) =>
    ipcRenderer.invoke('rpa-orchestrator:get-queue', profileId),
  rpaOrchestratorGetHistory: (profileId: string, limit?: number) =>
    ipcRenderer.invoke('rpa-orchestrator:get-history', profileId, limit),
  rpaOrchestratorCreateSchedule: (profileId: string, scriptId: string, scheduleConfig: unknown) =>
    ipcRenderer.invoke('rpa-orchestrator:create-schedule', profileId, scriptId, scheduleConfig),
  rpaOrchestratorCancelSchedule: (scheduleId: string) =>
    ipcRenderer.invoke('rpa-orchestrator:cancel-schedule', scheduleId),
  rpaOrchestratorGetSchedules: () =>
    ipcRenderer.invoke('rpa-orchestrator:get-schedules'),
  rpaOrchestratorSaveConfig: (profileId: string, config: unknown) =>
    ipcRenderer.invoke('rpa-orchestrator:save-config', profileId, config),
  rpaOrchestratorGetConfig: (profileId: string) =>
    ipcRenderer.invoke('rpa-orchestrator:get-config', profileId),
  rpaOrchestratorSetMaxConcurrency: (max: number) =>
    ipcRenderer.invoke('rpa-orchestrator:set-max-concurrency', max),

  // Event listeners for RPA orchestrator real-time updates
  onRpaTaskProgress: (callback: (event: unknown) => void) => {
    ipcRenderer.on('rpa-orchestrator:task-progress', (_event, data) => callback(data));
  },
  onRpaBatchComplete: (callback: (report: unknown) => void) => {
    ipcRenderer.on('rpa-orchestrator:batch-complete', (_event, data) => callback(data));
  },
  removeRpaTaskProgressListener: () => {
    ipcRenderer.removeAllListeners('rpa-orchestrator:task-progress');
  },
  removeRpaBatchCompleteListener: () => {
    ipcRenderer.removeAllListeners('rpa-orchestrator:batch-complete');
  },

  // ─── RBAC ───
  createUser: (request: unknown) => ipcRenderer.invoke('rbac:createUser', request),
  updateRole: (userId: string, role: unknown) => ipcRenderer.invoke('rbac:updateRole', userId, role),
  checkAccess: (userId: string, profileId: string, action: unknown) => ipcRenderer.invoke('rbac:checkAccess', userId, profileId, action),
  shareProfile: (profileId: string, targetUserId: string, permissions: unknown) => ipcRenderer.invoke('rbac:shareProfile', profileId, targetUserId, permissions),
  revokeAccess: (profileId: string, targetUserId: string) => ipcRenderer.invoke('rbac:revokeAccess', profileId, targetUserId),
  getUser: (userId: string) => ipcRenderer.invoke('rbac:getUser', userId),

  // ─── Logs ───
  queryLogs: (filter: unknown, callerRole?: unknown, callerUserId?: string) => ipcRenderer.invoke('logs:query', filter, callerRole, callerUserId),
  cleanupLogs: () => ipcRenderer.invoke('logs:cleanup'),

  // ─── Serializer ───
  serializeProfile: (config: unknown) => ipcRenderer.invoke('serializer:serialize', config),
  deserializeProfile: (json: string) => ipcRenderer.invoke('serializer:deserialize', json),
  validateProfileJSON: (json: string) => ipcRenderer.invoke('serializer:validate', json),
});
