import { useState } from 'react';
import type { SyncStatus } from '@shared/types';

interface SyncProfile {
  id: string;
  name: string;
  syncEnabled: boolean;
  syncStatus: SyncStatus | null;
  lastSyncedAt: string | null;
}

const DEMO_SYNC_PROFILES: SyncProfile[] = [
  { id: 'p-1', name: 'Facebook Account 1', syncEnabled: true, syncStatus: 'synced', lastSyncedAt: '2024-01-16T10:00:00Z' },
  { id: 'p-2', name: 'Amazon Seller', syncEnabled: false, syncStatus: null, lastSyncedAt: null },
  { id: 'p-3', name: 'TikTok Shop', syncEnabled: true, syncStatus: 'conflict', lastSyncedAt: '2024-01-15T14:00:00Z' },
];

export default function CloudSyncPage() {
  const [profiles, setProfiles] = useState<SyncProfile[]>(DEMO_SYNC_PROFILES);
  const [importJson, setImportJson] = useState('');
  const [exportResult, setExportResult] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const handleToggleSync = (id: string) => {
    // TODO: IPC call — window.electronAPI.toggleSync(id)
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, syncEnabled: !p.syncEnabled, syncStatus: !p.syncEnabled ? 'pending' : null } : p,
      ),
    );
  };

  const handleSync = (id: string) => {
    // TODO: IPC call — window.electronAPI.syncProfile(id)
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, syncStatus: 'synced', lastSyncedAt: new Date().toISOString() } : p,
      ),
    );
  };

  const handleResolveConflict = (id: string, resolution: 'local' | 'remote') => {
    // TODO: IPC call — window.electronAPI.resolveConflict(id, resolution)
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, syncStatus: 'synced', lastSyncedAt: new Date().toISOString() } : p,
      ),
    );
  };

  const handleExport = (id: string) => {
    // TODO: IPC call — window.electronAPI.exportProfile(id)
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      const exported = JSON.stringify(
        {
          id: profile.id,
          name: profile.name,
          browserType: 'chromium',
          fingerprint: { canvas: { noiseLevel: 0.5 }, webgl: { noiseLevel: 0.5 } },
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      );
      setExportResult(exported);
      setShowExport(true);
    }
  };

  const handleImport = () => {
    if (!importJson.trim()) return;
    // TODO: IPC call — window.electronAPI.importProfile(importJson)
    try {
      const parsed = JSON.parse(importJson);
      const imported: SyncProfile = {
        id: parsed.id ?? `p-${Date.now()}`,
        name: parsed.name ?? 'Imported Profile',
        syncEnabled: false,
        syncStatus: null,
        lastSyncedAt: null,
      };
      setProfiles((prev) => [...prev, imported]);
      setImportJson('');
      setShowImport(false);
    } catch {
      alert('JSON không hợp lệ');
    }
  };

  const handleSyncAll = () => {
    // TODO: IPC call — window.electronAPI.syncAllProfiles()
    setProfiles((prev) =>
      prev.map((p) =>
        p.syncEnabled ? { ...p, syncStatus: 'synced', lastSyncedAt: new Date().toISOString() } : p,
      ),
    );
  };

  return (
    <div className="page">
      <div className="section-header">
        <h2>Đồng bộ Đám mây & Xuất/Nhập</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={handleSyncAll}>Đồng bộ tất cả</button>
          <button className="btn" onClick={() => setShowImport(true)}>Nhập cấu hình</button>
        </div>
      </div>

      {/* Sync Status Table */}
      <div className="section">
        <h3>Trạng thái đồng bộ</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Hồ sơ</th>
                <th>Đồng bộ</th>
                <th>Trạng thái</th>
                <th>Đồng bộ lần cuối</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>{profile.name}</td>
                  <td>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={profile.syncEnabled}
                        onChange={() => handleToggleSync(profile.id)}
                      />
                      {profile.syncEnabled ? 'Bật' : 'Tắt'}
                    </label>
                  </td>
                  <td>
                    {profile.syncStatus ? (
                      <span className={`badge badge-${profile.syncStatus}`}>{profile.syncStatus}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{profile.lastSyncedAt ? new Date(profile.lastSyncedAt).toLocaleString() : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {profile.syncEnabled && (
                        <button className="btn btn-sm btn-primary" onClick={() => handleSync(profile.id)}>
                          Đồng bộ
                        </button>
                      )}
                      {profile.syncStatus === 'conflict' && (
                        <>
                          <button className="btn btn-sm btn-success" onClick={() => handleResolveConflict(profile.id, 'local')}>
                            Giữ local
                          </button>
                          <button className="btn btn-sm" onClick={() => handleResolveConflict(profile.id, 'remote')}>
                            Giữ remote
                          </button>
                        </>
                      )}
                      <button className="btn btn-sm" onClick={() => handleExport(profile.id)}>Xuất</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nhập cấu hình hồ sơ (JSON)</h3>
            <div className="form-group">
              <label htmlFor="import-json">JSON cấu hình</label>
              <textarea
                id="import-json"
                rows={10}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='{"name": "My Profile", "browserType": "chromium", ...}'
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleImport}>Nhập</button>
              <button className="btn" onClick={() => setShowImport(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="modal-overlay" onClick={() => setShowExport(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Xuất cấu hình hồ sơ</h3>
            <div className="form-group">
              <label htmlFor="export-json">JSON cấu hình</label>
              <textarea
                id="export-json"
                rows={10}
                value={exportResult}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </div>
            <div className="form-actions">
              <button
                className="btn btn-primary"
                onClick={() => { navigator.clipboard.writeText(exportResult); }}
              >
                Sao chép
              </button>
              <button className="btn" onClick={() => setShowExport(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
