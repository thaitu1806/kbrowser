import { useState } from 'react';
import type { Proxy, ProxyConfig } from '@shared/types';

const DEMO_PROXIES: Proxy[] = [
  {
    id: 'proxy-1',
    protocol: 'http',
    host: '192.168.1.100',
    port: 8080,
    username: 'user1',
    password: 'pass1',
    status: 'alive',
    responseTimeMs: 120,
    lastCheckedAt: '2024-01-16T10:00:00Z',
  },
  {
    id: 'proxy-2',
    protocol: 'socks5',
    host: '10.0.0.50',
    port: 1080,
    status: 'dead',
    responseTimeMs: null,
    lastCheckedAt: '2024-01-15T08:00:00Z',
  },
];

const defaultProxyConfig: ProxyConfig = {
  protocol: 'http',
  host: '',
  port: 8080,
};

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<Proxy[]>(DEMO_PROXIES);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProxyConfig>(defaultProxyConfig);
  const [assignProfileId, setAssignProfileId] = useState('');
  const [assigningProxyId, setAssigningProxyId] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingId(null);
    setFormData(defaultProxyConfig);
    setShowForm(true);
  };

  const handleEdit = (proxy: Proxy) => {
    setEditingId(proxy.id);
    setFormData({
      protocol: proxy.protocol,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!formData.host.trim()) return;

    if (editingId) {
      // TODO: IPC call — window.electronAPI.updateProxy(editingId, formData)
      setProxies((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? { ...p, protocol: formData.protocol, host: formData.host, port: formData.port, username: formData.username, password: formData.password }
            : p,
        ),
      );
    } else {
      // TODO: IPC call — window.electronAPI.addProxy(formData)
      const newProxy: Proxy = {
        id: `proxy-${Date.now()}`,
        ...formData,
        status: null,
        responseTimeMs: null,
        lastCheckedAt: null,
      };
      setProxies((prev) => [...prev, newProxy]);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    // TODO: IPC call — window.electronAPI.removeProxy(id)
    setProxies((prev) => prev.filter((p) => p.id !== id));
  };

  const handleCheck = (id: string) => {
    // TODO: IPC call — window.electronAPI.checkProxy(id)
    setProxies((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status: 'alive' as const, responseTimeMs: Math.floor(Math.random() * 300) + 50, lastCheckedAt: new Date().toISOString() }
          : p,
      ),
    );
  };

  const handleAssign = () => {
    if (!assigningProxyId || !assignProfileId.trim()) return;
    // TODO: IPC call — window.electronAPI.assignProxyToProfile(assigningProxyId, assignProfileId)
    setAssigningProxyId(null);
    setAssignProfileId('');
  };

  return (
    <div className="page">
      <div className="section-header">
        <h2>Quản lý Proxy</h2>
        <button className="btn btn-primary" onClick={handleCreate}>+ Thêm Proxy</button>
      </div>

      {proxies.length === 0 ? (
        <div className="empty-state">
          <p>Chưa có proxy nào.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Giao thức</th>
                <th>Host</th>
                <th>Port</th>
                <th>Xác thực</th>
                <th>Trạng thái</th>
                <th>Tốc độ</th>
                <th>Kiểm tra lần cuối</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {proxies.map((proxy) => (
                <tr key={proxy.id}>
                  <td>{proxy.protocol.toUpperCase()}</td>
                  <td>{proxy.host}</td>
                  <td>{proxy.port}</td>
                  <td>{proxy.username ? '✓' : '—'}</td>
                  <td>
                    {proxy.status ? (
                      <span className={`badge badge-${proxy.status}`}>{proxy.status}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{proxy.responseTimeMs != null ? `${proxy.responseTimeMs}ms` : '—'}</td>
                  <td>{proxy.lastCheckedAt ? new Date(proxy.lastCheckedAt).toLocaleString() : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-sm" onClick={() => handleCheck(proxy.id)}>Kiểm tra</button>
                      <button className="btn btn-sm" onClick={() => { setAssigningProxyId(proxy.id); setAssignProfileId(''); }}>Gán</button>
                      <button className="btn btn-sm" onClick={() => handleEdit(proxy)}>Sửa</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(proxy.id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Proxy Form */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? 'Sửa Proxy' : 'Thêm Proxy mới'}</h3>
            <div className="form-group">
              <label htmlFor="proxy-protocol">Giao thức</label>
              <select
                id="proxy-protocol"
                value={formData.protocol}
                onChange={(e) => setFormData({ ...formData, protocol: e.target.value as 'http' | 'https' | 'socks5' })}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="proxy-host">Host</label>
                <input
                  id="proxy-host"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  placeholder="192.168.1.100"
                />
              </div>
              <div className="form-group">
                <label htmlFor="proxy-port">Port</label>
                <input
                  id="proxy-port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="proxy-user">Username (tùy chọn)</label>
                <input
                  id="proxy-user"
                  value={formData.username ?? ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value || undefined })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="proxy-pass">Password (tùy chọn)</label>
                <input
                  id="proxy-pass"
                  type="password"
                  value={formData.password ?? ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value || undefined })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleSave}>Lưu</button>
              <button className="btn" onClick={() => setShowForm(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Proxy Dialog */}
      {assigningProxyId && (
        <div className="modal-overlay" onClick={() => setAssigningProxyId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Gán Proxy cho Hồ sơ</h3>
            <div className="form-group">
              <label htmlFor="assign-profile">Profile ID</label>
              <input
                id="assign-profile"
                value={assignProfileId}
                onChange={(e) => setAssignProfileId(e.target.value)}
                placeholder="Nhập ID hồ sơ..."
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleAssign}>Gán</button>
              <button className="btn" onClick={() => setAssigningProxyId(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
