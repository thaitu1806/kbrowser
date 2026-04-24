import { useState, useEffect, useCallback } from 'react';
import type { ProfileSummary } from '@shared/types';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

export default function TrashPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      if (api?.listDeletedProfiles) {
        const list = await api.listDeletedProfiles();
        setProfiles(list);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === profiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(profiles.map((p) => p.id)));
    }
  };

  const handleRestore = async (id: string) => {
    try {
      if (api?.restoreProfile) {
        await api.restoreProfile(id);
        await loadTrash();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to restore profile');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    if (!confirm('Permanently delete this profile? This cannot be undone.')) return;
    try {
      if (api?.permanentDeleteProfile) {
        await api.permanentDeleteProfile(id);
        await loadTrash();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const handleBatchRestore = async () => {
    for (const id of selectedIds) {
      try {
        if (api?.restoreProfile) await api.restoreProfile(id);
      } catch { /* skip */ }
    }
    setSelectedIds(new Set());
    await loadTrash();
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Permanently delete ${selectedIds.size} profiles? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      try {
        if (api?.permanentDeleteProfile) await api.permanentDeleteProfile(id);
      } catch { /* skip */ }
    }
    setSelectedIds(new Set());
    await loadTrash();
  };

  const handleEmptyTrash = async () => {
    if (!confirm('Permanently delete ALL profiles in trash? This cannot be undone.')) return;
    for (const p of profiles) {
      try {
        if (api?.permanentDeleteProfile) await api.permanentDeleteProfile(p.id);
      } catch { /* skip */ }
    }
    setSelectedIds(new Set());
    await loadTrash();
  };

  return (
    <div className="profiles-page">
      <div className="page-header">
        <h1 className="page-title">🗑️ Trash</h1>
        <div className="header-actions">
          {profiles.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={handleEmptyTrash}>
              Empty Trash
            </button>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="profiles-action-bar">
        <div className="action-bar-left">
          <button
            className="action-btn action-btn-primary"
            onClick={handleBatchRestore}
            disabled={selectedIds.size === 0}
          >
            ↩ Restore ({selectedIds.size})
          </button>
          <button
            className="action-btn"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
          >
            🗑️ Delete Forever
          </button>
        </div>
      </div>

      {loading && <div className="loading-bar">Loading trash...</div>}

      <div className="profiles-table-container">
        <table className="profiles-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  type="checkbox"
                  checked={selectedIds.size === profiles.length && profiles.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="col-name">Name</th>
              <th className="col-platform">Browser</th>
              <th className="col-lastop">Last opened</th>
              <th className="col-action" style={{ width: 200 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>🗑️</p>
                  <p>Trash is empty</p>
                  <p style={{ fontSize: 12, color: '#a0aec0', marginTop: 8 }}>
                    Deleted profiles will appear here for recovery.
                  </p>
                </td>
              </tr>
            )}
            {profiles.map((profile) => (
              <tr key={profile.id} className={selectedIds.has(profile.id) ? 'selected' : ''}>
                <td className="col-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(profile.id)}
                    onChange={() => toggleSelect(profile.id)}
                  />
                </td>
                <td className="col-name">
                  <span className="profile-name-text">{profile.name}</span>
                </td>
                <td className="col-platform">
                  <span className="browser-type-label">
                    {profile.browserType === 'chromium' ? '🌐 Sun' : '🦊 Flower'}
                  </span>
                </td>
                <td className="col-lastop">
                  {profile.lastUsedAt ? new Date(profile.lastUsedAt).toLocaleDateString() : '—'}
                </td>
                <td className="col-action">
                  <button className="btn btn-sm" style={{ marginRight: 6 }} onClick={() => handleRestore(profile.id)}>
                    ↩ Restore
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handlePermanentDelete(profile.id)}>
                    Delete Forever
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="profiles-footer">
        <span className="total-count">Total: {profiles.length}</span>
      </div>
    </div>
  );
}
