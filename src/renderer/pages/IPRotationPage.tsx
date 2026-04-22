import { useState } from 'react';
import type { RotationConfig } from '@shared/types';

interface ProfileRotation {
  profileId: string;
  profileName: string;
  currentIP: string | null;
  config: RotationConfig;
  lastRotatedAt: string | null;
}

const DEMO_ROTATIONS: ProfileRotation[] = [
  {
    profileId: 'p-1',
    profileName: 'Facebook Account 1',
    currentIP: '203.0.113.42',
    config: { enabled: true, intervalSeconds: 300, provider: 'luminati', apiKey: '***' },
    lastRotatedAt: '2024-01-16T10:05:00Z',
  },
  {
    profileId: 'p-2',
    profileName: 'Amazon Seller',
    currentIP: null,
    config: { enabled: false, intervalSeconds: 600, provider: 'oxylabs', apiKey: '' },
    lastRotatedAt: null,
  },
];

export default function IPRotationPage() {
  const [rotations, setRotations] = useState<ProfileRotation[]>(DEMO_ROTATIONS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<RotationConfig>({
    enabled: false,
    intervalSeconds: 300,
    provider: 'luminati',
    apiKey: '',
  });

  const handleEdit = (rotation: ProfileRotation) => {
    setEditingId(rotation.profileId);
    setEditConfig({ ...rotation.config });
  };

  const handleSave = () => {
    if (!editingId) return;
    // TODO: IPC call — window.electronAPI.configureRotation(editingId, editConfig)
    setRotations((prev) =>
      prev.map((r) => (r.profileId === editingId ? { ...r, config: { ...editConfig } } : r)),
    );
    setEditingId(null);
  };

  const handleRotateNow = (profileId: string) => {
    // TODO: IPC call — window.electronAPI.rotateIP(profileId)
    const newIP = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    setRotations((prev) =>
      prev.map((r) =>
        r.profileId === profileId
          ? { ...r, currentIP: newIP, lastRotatedAt: new Date().toISOString() }
          : r,
      ),
    );
  };

  const handleToggle = (profileId: string) => {
    // TODO: IPC call — window.electronAPI.configureRotation(profileId, { ...config, enabled: !config.enabled })
    setRotations((prev) =>
      prev.map((r) =>
        r.profileId === profileId ? { ...r, config: { ...r.config, enabled: !r.config.enabled } } : r,
      ),
    );
  };

  return (
    <div className="page">
      <h2>Cấu hình Xoay vòng IP</h2>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Hồ sơ</th>
              <th>Trạng thái</th>
              <th>IP hiện tại</th>
              <th>Nhà cung cấp</th>
              <th>Khoảng thời gian</th>
              <th>Xoay vòng lần cuối</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {rotations.map((rotation) => (
              <tr key={rotation.profileId}>
                <td>{rotation.profileName}</td>
                <td>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={rotation.config.enabled}
                      onChange={() => handleToggle(rotation.profileId)}
                    />
                    {rotation.config.enabled ? (
                      <span className="badge badge-alive">Bật</span>
                    ) : (
                      <span className="badge" style={{ background: '#e2e3e5', color: '#383d41' }}>Tắt</span>
                    )}
                  </label>
                </td>
                <td style={{ fontFamily: 'monospace' }}>{rotation.currentIP ?? '—'}</td>
                <td>{rotation.config.provider}</td>
                <td>{rotation.config.intervalSeconds}s</td>
                <td>{rotation.lastRotatedAt ? new Date(rotation.lastRotatedAt).toLocaleString() : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => handleRotateNow(rotation.profileId)}>
                      Xoay ngay
                    </button>
                    <button className="btn btn-sm" onClick={() => handleEdit(rotation)}>Cấu hình</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rotations.length === 0 && (
        <div className="empty-state">
          <p>Chưa có hồ sơ nào được cấu hình xoay vòng IP.</p>
        </div>
      )}

      {/* Edit Config Modal */}
      {editingId && (
        <div className="modal-overlay" onClick={() => setEditingId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Cấu hình xoay vòng IP — {rotations.find((r) => r.profileId === editingId)?.profileName}</h3>
            <div className="form-group">
              <label htmlFor="rotation-provider">Nhà cung cấp</label>
              <select
                id="rotation-provider"
                value={editConfig.provider}
                onChange={(e) => setEditConfig({ ...editConfig, provider: e.target.value as 'luminati' | 'oxylabs' })}
              >
                <option value="luminati">Luminati</option>
                <option value="oxylabs">Oxylabs</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="rotation-interval">Khoảng thời gian (giây)</label>
              <input
                id="rotation-interval"
                type="number"
                min={60}
                max={3600}
                value={editConfig.intervalSeconds}
                onChange={(e) => setEditConfig({ ...editConfig, intervalSeconds: parseInt(e.target.value) || 300 })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="rotation-apikey">API Key</label>
              <input
                id="rotation-apikey"
                type="password"
                value={editConfig.apiKey}
                onChange={(e) => setEditConfig({ ...editConfig, apiKey: e.target.value })}
                placeholder="Nhập API key..."
              />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editConfig.enabled}
                  onChange={(e) => setEditConfig({ ...editConfig, enabled: e.target.checked })}
                />
                Bật xoay vòng tự động
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleSave}>Lưu</button>
              <button className="btn" onClick={() => setEditingId(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
