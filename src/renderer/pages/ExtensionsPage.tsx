import { useState } from 'react';
import type { Extension } from '@shared/types';

const DEMO_EXTENSIONS: Extension[] = [
  {
    id: 'ext-1',
    name: 'uBlock Origin',
    version: '1.55.0',
    source: 'store',
    assignedProfiles: ['p-1', 'p-2'],
  },
  {
    id: 'ext-2',
    name: 'Cookie Editor',
    version: '1.12.1',
    source: 'upload',
    assignedProfiles: ['p-1'],
  },
];

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>(DEMO_EXTENSIONS);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [storeUrl, setStoreUrl] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [assignExtId, setAssignExtId] = useState<string | null>(null);
  const [assignProfileIds, setAssignProfileIds] = useState('');

  const handleUpload = () => {
    if (!uploadName.trim()) return;
    // TODO: IPC call — window.electronAPI.uploadExtension(fileBuffer, filename)
    const newExt: Extension = {
      id: `ext-${Date.now()}`,
      name: uploadName,
      version: '1.0.0',
      source: 'upload',
      assignedProfiles: [],
    };
    setExtensions((prev) => [...prev, newExt]);
    setUploadName('');
    setShowUploadForm(false);
  };

  const handleDownloadFromStore = () => {
    if (!storeUrl.trim()) return;
    // TODO: IPC call — window.electronAPI.downloadFromStore(storeUrl)
    const newExt: Extension = {
      id: `ext-${Date.now()}`,
      name: `Store Extension (${storeUrl.slice(-10)})`,
      version: '1.0.0',
      source: 'store',
      assignedProfiles: [],
    };
    setExtensions((prev) => [...prev, newExt]);
    setStoreUrl('');
    setShowStoreForm(false);
  };

  const handleRemove = (id: string) => {
    // TODO: IPC call — window.electronAPI.removeExtension(id)
    setExtensions((prev) => prev.filter((e) => e.id !== id));
  };

  const handleAssign = () => {
    if (!assignExtId || !assignProfileIds.trim()) return;
    const profileIds = assignProfileIds.split(',').map((s) => s.trim()).filter(Boolean);
    // TODO: IPC call — window.electronAPI.assignExtensionToProfiles(assignExtId, profileIds)
    setExtensions((prev) =>
      prev.map((ext) =>
        ext.id === assignExtId
          ? { ...ext, assignedProfiles: [...new Set([...ext.assignedProfiles, ...profileIds])] }
          : ext,
      ),
    );
    setAssignExtId(null);
    setAssignProfileIds('');
  };

  return (
    <div className="page">
      <div className="section-header">
        <h2>Quản lý Tiện ích mở rộng</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={() => setShowUploadForm(true)}>Tải lên .zip</button>
          <button className="btn" onClick={() => setShowStoreForm(true)}>Tải từ Chrome Store</button>
        </div>
      </div>

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
              <label htmlFor="ext-name">Tên tiện ích</label>
              <input
                id="ext-name"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="Nhập tên tiện ích..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="ext-file">File .zip</label>
              <input id="ext-file" type="file" accept=".zip" />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleUpload}>Tải lên</button>
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
