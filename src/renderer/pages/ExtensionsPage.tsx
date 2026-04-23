import { useState, useEffect, useCallback, useRef } from 'react';
import type { Extension } from '@shared/types';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [storeUrl, setStoreUrl] = useState('');
  const [assignExtId, setAssignExtId] = useState<string | null>(null);
  const [assignProfileIds, setAssignProfileIds] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadExtensions = useCallback(async () => {
    if (!api) return;
    try {
      setError(null);
      const list = await api.listExtensions();
      setExtensions(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadExtensions(); }, [loadExtensions]);

  const handleUpload = async () => {
    if (!api) return;
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.length) {
      setError('Please select a .zip file');
      return;
    }

    const file = fileInput.files[0];
    setUploading(true);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileData = Array.from(new Uint8Array(arrayBuffer));
      await api.uploadExtension(fileData, file.name);
      await loadExtensions();
      setShowUploadForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload extension');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadFromStore = () => {
    if (!storeUrl.trim()) return;
    // Store download is not yet implemented in backend — show info
    setError('Chrome Store download is not yet supported. Please upload a .zip file instead.');
    setShowStoreForm(false);
    setStoreUrl('');
  };

  const handleRemove = async (id: string) => {
    if (!api) return;
    try {
      await api.removeExtension(id);
      await loadExtensions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove extension');
    }
  };

  const handleAssign = async () => {
    if (!assignExtId || !assignProfileIds.trim()) return;
    if (!api) return;
    const profileIds = assignProfileIds.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      await api.assignExtension(assignExtId, profileIds);
      await loadExtensions();
      setAssignExtId(null);
      setAssignProfileIds('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign extension');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2>Quản lý Tiện ích mở rộng</h2>
        <div className="empty-state"><p>Đang tải...</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-header">
        <h2>Quản lý Tiện ích mở rộng</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={() => setShowUploadForm(true)}>Tải lên .zip</button>
          <button className="btn" onClick={() => setShowStoreForm(true)}>Tải từ Chrome Store</button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
          ⚠ {error}
          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {extensions.length === 0 ? (
        <div className="empty-state">
          <p>Chưa có tiện ích nào.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Phiên bản</th>
                <th>Nguồn</th>
                <th>Hồ sơ đã gán</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {extensions.map((ext) => (
                <tr key={ext.id}>
                  <td>{ext.name}</td>
                  <td>{ext.version}</td>
                  <td>
                    <span className="badge" style={{ background: ext.source === 'store' ? '#e8f0fe' : '#fff3cd', color: ext.source === 'store' ? '#1a73e8' : '#856404' }}>
                      {ext.source === 'store' ? 'Chrome Store' : 'Upload'}
                    </span>
                  </td>
                  <td>
                    {ext.assignedProfiles.length > 0 ? (
                      <span style={{ fontSize: '0.8rem' }}>{ext.assignedProfiles.join(', ')}</span>
                    ) : (
                      <span style={{ color: '#999' }}>Chưa gán</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-sm" onClick={() => { setAssignExtId(ext.id); setAssignProfileIds(''); }}>
                        Gán
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemove(ext.id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Form */}
      {showUploadForm && (
        <div className="modal-overlay" onClick={() => setShowUploadForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tải lên tiện ích (.zip)</h3>
            <div className="form-group">
              <label htmlFor="ext-file">File .zip</label>
              <input id="ext-file" type="file" accept=".zip" ref={fileInputRef} />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Đang tải...' : 'Tải lên'}
              </button>
              <button className="btn" onClick={() => setShowUploadForm(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Store Download Form */}
      {showStoreForm && (
        <div className="modal-overlay" onClick={() => setShowStoreForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tải từ Chrome Web Store</h3>
            <div className="form-group">
              <label htmlFor="store-url">URL Chrome Web Store</label>
              <input
                id="store-url"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder="https://chrome.google.com/webstore/detail/..."
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleDownloadFromStore}>Tải về</button>
              <button className="btn" onClick={() => setShowStoreForm(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Dialog */}
      {assignExtId && (
        <div className="modal-overlay" onClick={() => setAssignExtId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Gán tiện ích cho hồ sơ</h3>
            <div className="form-group">
              <label htmlFor="assign-profiles">Profile IDs (phân cách bằng dấu phẩy)</label>
              <input
                id="assign-profiles"
                value={assignProfileIds}
                onChange={(e) => setAssignProfileIds(e.target.value)}
                placeholder="p-1, p-2, p-3"
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleAssign}>Gán</button>
              <button className="btn" onClick={() => setAssignExtId(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
