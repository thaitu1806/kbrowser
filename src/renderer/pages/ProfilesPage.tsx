import { useState, useEffect, useCallback } from 'react';
import type { ProfileSummary, ProfileConfig, FingerprintConfig } from '@shared/types';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

const defaultFingerprint: FingerprintConfig = {
  canvas: { noiseLevel: 0.5 },
  webgl: { noiseLevel: 0.5 },
  audioContext: { frequencyOffset: 0.01 },
  cpu: { cores: 4 },
  ram: { sizeGB: 8 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  fonts: ['Arial', 'Helvetica', 'Times New Roman'],
  webrtc: 'proxy',
  platform: 'Win32',
  appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
  oscpu: 'Windows NT 10.0; Win64; x64',
};

export default function ProfilesPage({ onNewProfile, onEditProfile }: { onNewProfile?: () => void; onEditProfile?: (id: string) => void }) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('All groups');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openStatus, setOpenStatus] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<ProfileConfig>({
    name: '', browserType: 'chromium', fingerprint: defaultFingerprint,
  });

  // Load profiles from backend
  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (api) {
        const list = await api.listProfiles();
        setProfiles(list);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
    // Listen for browser download status
    if (api?.onOpenStatus) {
      api.onOpenStatus((data) => {
        setOpenStatus(data.message);
      });
    }
    // Auto-poll every 3 seconds to detect browser close
    const interval = setInterval(() => {
      if (api) loadProfiles();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadProfiles]);

  const filteredProfiles = profiles.filter((p) =>
    searchQuery ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) : true,
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProfiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProfiles.map((p) => p.id)));
    }
  };

  const handleOpen = async (id: string) => {
    try {
      setOpeningId(id);
      setOpenStatus('Starting browser...');
      if (api) {
        await api.openProfile(id);
        await loadProfiles();
      }
      setOpenStatus(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to open profile');
      setOpenStatus(null);
    } finally {
      setOpeningId(null);
    }
  };

  const handleClose = async (id: string) => {
    try {
      if (api) {
        await api.closeProfile(id);
        await loadProfiles();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to close profile');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this profile?')) return;
    try {
      if (api) {
        await api.deleteProfile(id);
        await loadProfiles();
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const handleBatchOpen = async () => {
    for (const id of selectedIds) {
      const p = profiles.find((pr) => pr.id === id);
      if (p && p.status === 'closed') {
        try {
          if (api) await api.openProfile(id);
        } catch { /* skip failed */ }
      }
    }
    setSelectedIds(new Set());
    await loadProfiles();
  };

  const handleBatchClose = async () => {
    for (const id of selectedIds) {
      const p = profiles.find((pr) => pr.id === id);
      if (p && p.status === 'open') {
        try {
          if (api) await api.closeProfile(id);
        } catch { /* skip failed */ }
      }
    }
    setSelectedIds(new Set());
    await loadProfiles();
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} selected profiles?`)) return;
    for (const id of selectedIds) {
      try {
        if (api) await api.deleteProfile(id);
      } catch { /* skip failed */ }
    }
    setSelectedIds(new Set());
    await loadProfiles();
  };

  const handleQuickCreate = async () => {
    if (!formData.name.trim()) return;
    try {
      if (api) {
        await api.createProfile(formData);
        await loadProfiles();
      }
      setShowForm(false);
      setFormData({ name: '', browserType: 'chromium', fingerprint: defaultFingerprint });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create profile');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}\n${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <div className="profiles-page">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Profiles</h1>
        <div className="header-actions">
          {!api && <span className="no-electron-badge">⚠ Demo mode (no Electron)</span>}
          <div className="user-info">
            <div className="user-avatar">👤</div>
            <div>
              <div className="user-name">admin</div>
              <div className="user-role">Owner</div>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="profiles-toolbar">
        <div className="toolbar-left">
          <select className="group-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option>All groups</option>
            <option>Ungrouped</option>
          </select>
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search or new search criteria"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="toolbar-filter-btn" onClick={loadProfiles} title="Refresh">🔄</button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="profiles-action-bar">
        <div className="action-bar-left">
          <button
            className="action-btn action-btn-primary"
            onClick={handleBatchOpen}
            disabled={selectedIds.size === 0}
          >
            Open ({selectedIds.size})
          </button>
          <button className="action-btn" title="Close selected" onClick={handleBatchClose} disabled={selectedIds.size === 0}>✕ Close</button>
          <button className="action-btn" title="Delete selected" onClick={handleBatchDelete} disabled={selectedIds.size === 0}>🗑️ Delete</button>
        </div>
        <div className="action-bar-right">
          <button className="btn-new-profile-main" onClick={onNewProfile ?? (() => setShowForm(true))}>
            + New Profile
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="error-banner">
          ⚠ {error}
          <button onClick={loadProfiles}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && <div className="loading-bar">Loading profiles...</div>}
      {openStatus && <div className="loading-bar">🌐 {openStatus}</div>}

      {/* Profiles Table */}
      <div className="profiles-table-container">
        <table className="profiles-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredProfiles.length && filteredProfiles.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="col-group">Group</th>
              <th className="col-name">Name ↕</th>
              <th className="col-ip">Proxy</th>
              <th className="col-lastop">Last opened</th>
              <th className="col-platform">Browser</th>
              <th className="col-tags">Tags</th>
              <th className="col-action">Action</th>
              <th className="col-more"></th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.length === 0 && !loading && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  {profiles.length === 0 ? 'No profiles yet. Click "+ New Profile" to create one.' : 'No profiles match your search.'}
                </td>
              </tr>
            )}
            {filteredProfiles.map((profile) => (
              <tr key={profile.id} className={selectedIds.has(profile.id) ? 'selected' : ''}>
                <td className="col-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(profile.id)}
                    onChange={() => toggleSelect(profile.id)}
                  />
                </td>
                <td className="col-group">
                  <span className="group-label">Ungrouped</span>
                </td>
                <td className="col-name">
                  <div className="profile-name-cell">
                    <span className="profile-name-text">{profile.name}</span>
                  </div>
                </td>
                <td className="col-ip">
                  <div className="ip-cell">
                    {profile.proxyAssigned ? (
                      <span className="ip-address">{profile.proxyAssigned}</span>
                    ) : (
                      <span className="no-proxy">No proxy</span>
                    )}
                  </div>
                </td>
                <td className="col-lastop">
                  <span className="lastop-date">{formatDate(profile.lastUsedAt)}</span>
                </td>
                <td className="col-platform">
                  <span className="browser-type-label">
                    {profile.browserType === 'chromium' ? '🌐 Sun' : '🦊 Flower'}
                  </span>
                </td>
                <td className="col-tags">
                  <span className="tag-dash">-</span>
                </td>
                <td className="col-action">
                  {profile.status === 'closed' ? (
                    <button
                      className="btn-open"
                      onClick={() => handleOpen(profile.id)}
                      disabled={openingId === profile.id}
                    >
                      {openingId === profile.id ? '⏳' : '✅ Open'}
                    </button>
                  ) : (
                    <button className="btn-action-close" onClick={() => handleClose(profile.id)}>🔴 Close</button>
                  )}
                </td>
                <td className="col-more">
                  <ProfileMenu
                    profileId={profile.id}
                    onDelete={() => handleDelete(profile.id)}
                    onEdit={() => onEditProfile?.(profile.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="profiles-footer">
        <span className="total-count">Total: {filteredProfiles.length}</span>
        <div className="pagination">
          <button className="page-btn">‹</button>
          <span className="page-num">1</span>
          <span className="page-sep">/ 1</span>
          <button className="page-btn">›</button>
          <select className="page-size">
            <option>50/page</option>
            <option>100/page</option>
          </select>
        </div>
      </div>

      {/* Quick Create Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Quick Create Profile</h3>
            <div className="form-group">
              <label htmlFor="profile-name">Profile Name</label>
              <input id="profile-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter profile name..." />
            </div>
            <div className="form-group">
              <label htmlFor="browser-type">Browser</label>
              <select id="browser-type" value={formData.browserType} onChange={(e) => setFormData({ ...formData, browserType: e.target.value as 'chromium' | 'firefox' })}>
                <option value="chromium">SunBrowser (Chromium)</option>
                <option value="firefox">FlowerBrowser (Firefox)</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleQuickCreate}>Create</button>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ profileId, onDelete, onEdit }: { profileId: string; onDelete: () => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false);

  const handleCopy = async () => {
    setOpen(false);
    try {
      if (api) {
        // Get full profile, create a copy with new name
        const profiles = await api.listProfiles();
        const original = profiles.find((p) => p.id === profileId);
        if (!original) return;
        await api.createProfile({
          name: `${original.name} (copy)`,
          browserType: original.browserType,
          fingerprint: {
            canvas: { noiseLevel: 0.5 }, webgl: { noiseLevel: 0.5 },
            audioContext: { frequencyOffset: 0.01 }, cpu: { cores: 4 }, ram: { sizeGB: 8 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            fonts: ['Arial'], webrtc: 'disable', platform: 'Win32',
            appVersion: '5.0', oscpu: 'Windows NT 10.0',
          },
        });
        window.location.reload();
      }
    } catch (err: unknown) {
      alert(`Copy failed: ${err instanceof Error ? err.message : 'Error'}`);
    }
  };

  const handleClearCache = async () => {
    setOpen(false);
    // TODO: implement cache clearing for profile
    alert(`Cache data cleared for profile ${profileId}`);
  };

  const handleEditProxy = async () => {
    setOpen(false);
    onEdit(); // Navigate to profile edit form (Proxy tab)
  };

  const handleEditFingerprint = async () => {
    setOpen(false);
    onEdit(); // Navigate to profile edit form (Fingerprint tab)
  };

  const handleEditAccount = async () => {
    setOpen(false);
    onEdit(); // Navigate to profile edit form (General tab)
  };

  const handleCookieRobot = async () => {
    setOpen(false);
    alert('Cookie robot — coming soon');
  };

  const items = [
    { label: '✏️ Edit', action: () => { onEdit(); setOpen(false); } },
    { label: '📋 Copy', action: handleCopy },
    { label: '🗑️ Delete', action: () => { onDelete(); setOpen(false); } },
    { divider: true },
    { label: '💾 Cache data', action: handleClearCache },
    { label: '🤖 Cookie robot', action: handleCookieRobot },
    { divider: true },
    { label: '🌐 Edit proxy', action: handleEditProxy },
    { label: '👤 Edit account', action: handleEditAccount },
    { label: '🖐️ Edit fingerprint', action: handleEditFingerprint },
  ];

  return (
    <div className="profile-menu-wrapper">
      <button className="btn-more" onClick={() => setOpen(!open)}>⋮</button>
      {open && (
        <>
          <div className="profile-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="profile-menu-dropdown">
            {items.map((item, i) =>
              'divider' in item ? (
                <div key={i} className="profile-menu-divider" />
              ) : (
                <button key={i} className="profile-menu-item" onClick={item.action}>
                  {item.label}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
