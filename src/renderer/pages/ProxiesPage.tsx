import { useState, useEffect, useCallback } from 'react';
import type { Proxy, ProxyConfig } from '@shared/types';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

const defaultProxyConfig: ProxyConfig = {
  protocol: 'http',
  host: '',
  port: 8080,
};

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProxyConfig>(defaultProxyConfig);
  const [assignProfileId, setAssignProfileId] = useState('');
  const [assigningProxyId, setAssigningProxyId] = useState<string | null>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  const loadProxies = useCallback(async () => {
    if (!api) return;
    try {
      setError(null);
      const list = await api.listProxies();
      // Map DB snake_case rows to camelCase Proxy type
      const mapped: Proxy[] = (list as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        protocol: (row.protocol as Proxy['protocol']),
        host: row.host as string,
        port: row.port as number,
        username: (row.username as string) || undefined,
        password: (row.password as string) || undefined,
        status: (row.status as Proxy['status']) || null,
        responseTimeMs: (row.responseTimeMs ?? row.response_time_ms ?? null) as number | null,
        lastCheckedAt: (row.lastCheckedAt ?? row.last_checked_at ?? null) as string | null,
      }));
      setProxies(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load proxies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProxies(); }, [loadProxies]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => { loadProxies(); }, 5000);
    return () => clearInterval(interval);
  }, [loadProxies]);

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

  const [saveChecking, setSaveChecking] = useState(false);
  const [saveCheckResult, setSaveCheckResult] = useState<{ status: string; message: string } | null>(null);

  const handleSave = async () => {
    if (!formData.host.trim()) return;
    if (!api) return;

    // Check proxy live before saving
    setSaveChecking(true);
    setSaveCheckResult(null);
    try {
      const result = await api.checkProxyDirect(formData);
      if (!result.success) {
        setSaveCheckResult({
          status: 'error',
          message: `❌ Proxy is dead! Cannot save.\n${result.error || 'Connection failed'}\nResponse: ${result.responseTimeMs}ms`,
        });
        setSaveChecking(false);
        return;
      }
      setSaveCheckResult({
        status: 'success',
        message: `✅ Proxy alive! IP: ${result.ip || 'Unknown'}${result.country ? ` | ${result.country}` : ''}${result.city ? ` / ${result.city}` : ''} | ${result.responseTimeMs}ms`,
      });
    } catch (err: unknown) {
      setSaveCheckResult({
        status: 'error',
        message: `❌ Check failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
      setSaveChecking(false);
      return;
    }
    setSaveChecking(false);

    // Proxy is alive — save it
    try {
      if (editingId) {
        await api.removeProxy(editingId);
        await api.addProxy(formData);
      } else {
        await api.addProxy(formData);
      }
      await loadProxies();
      setShowForm(false);
      setSaveCheckResult(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save proxy');
    }
  };

  const handleDelete = async (id: string) => {
    if (!api) return;
    try {
      await api.removeProxy(id);
      await loadProxies();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete proxy');
    }
  };

  const handleCheck = async (id: string) => {
    if (!api) return;
    setCheckingIds((prev) => new Set(prev).add(id));
    try {
      // Find proxy config for direct check with geo info
      const proxy = proxies.find((p) => p.id === id);
      if (proxy) {
        const result = await api.checkProxyDirect({
          protocol: proxy.protocol,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password,
        });
        setProxies((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: result.success ? 'alive' as const : 'dead' as const,
                  responseTimeMs: result.responseTimeMs,
                  lastCheckedAt: new Date().toISOString(),
                }
              : p,
          ),
        );
        // Also update in DB
        try {
          await api.updateProxyStatus(id, result.success ? 'alive' : 'dead', result.responseTimeMs);
        } catch { /* ignore */ }
        if (result.success) {
          alert(`✅ Proxy alive!\nIP: ${result.ip || 'Unknown'}${result.country ? `\nCountry: ${result.country}` : ''}${result.region ? `\nRegion: ${result.region}` : ''}${result.city ? `\nCity: ${result.city}` : ''}\nResponse: ${result.responseTimeMs}ms`);
        } else {
          alert(`❌ Proxy dead!\n${result.error || 'Connection failed'}\nResponse: ${result.responseTimeMs}ms`);
        }
      }
    } catch (err: unknown) {
      setProxies((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: 'dead' as const, lastCheckedAt: new Date().toISOString() }
            : p,
        ),
      );
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleAssign = async () => {
    if (!assigningProxyId || !assignProfileId.trim()) return;
    if (!api) return;
    try {
      await api.assignProxy(assigningProxyId, assignProfileId.trim());
      setAssigningProxyId(null);
      setAssignProfileId('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign proxy');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2>Quản lý Proxy</h2>
        <div className="empty-state"><p>Đang tải...</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-header">
        <h2>Quản lý Proxy</h2>
        <button className="btn btn-primary" onClick={handleCreate}>+ Thêm Proxy</button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
          ⚠ {error}
          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

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
                      <button
                        className="btn btn-sm"
                        onClick={() => handleCheck(proxy.id)}
                        disabled={checkingIds.has(proxy.id)}
                      >
                        {checkingIds.has(proxy.id) ? '...' : 'Kiểm tra'}
                      </button>
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
            {saveCheckResult && (
              <div className={`proxy-check-result ${saveCheckResult.status}`} style={{ marginBottom: 12 }}>
                {saveCheckResult.message}
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleSave} disabled={saveChecking}>
                {saveChecking ? '⏳ Checking...' : 'Lưu'}
              </button>
              <button className="btn" onClick={() => { setShowForm(false); setSaveCheckResult(null); }}>Hủy</button>
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
