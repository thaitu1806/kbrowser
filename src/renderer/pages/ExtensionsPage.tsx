import { useState, useEffect, useCallback, useRef } from 'react';
import type { Extension } from '@shared/types';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [assignExtId, setAssignExtId] = useState<string | null>(null);
  const [assignProfileIds, setAssignProfileIds] = useState('');

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
        <h2>Extensions</h2>
        <div className="empty-state"><p>Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-header">
        <h2>Extensions</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add Extension</button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
          ⚠ {error}
          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {extensions.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32, marginBottom: 8 }}>🧩</p>
          <p>No extensions yet.</p>
          <p style={{ fontSize: 12, color: '#a0aec0', marginTop: 8 }}>Click "+ Add Extension" to upload one.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Source</th>
                <th>Assigned Profiles</th>
                <th>Action</th>
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
                      <span style={{ fontSize: 12 }}>{ext.assignedProfiles.join(', ')}</span>
                    ) : (
                      <span style={{ color: '#999' }}>Not assigned</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm" onClick={() => { setAssignExtId(ext.id); setAssignProfileIds(''); }}>Assign</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemove(ext.id)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Extension Modal */}
      {showAddModal && (
        <AddExtensionModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); loadExtensions(); }}
        />
      )}

      {/* Assign Dialog */}
      {assignExtId && (
        <div className="modal-overlay" onClick={() => setAssignExtId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Assign extension to profiles</h3>
            <div className="form-group">
              <label htmlFor="assign-profiles">Profile IDs (comma separated)</label>
              <input
                id="assign-profiles"
                value={assignProfileIds}
                onChange={(e) => setAssignProfileIds(e.target.value)}
                placeholder="profile-id-1, profile-id-2"
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleAssign}>Assign</button>
              <button className="btn" onClick={() => setAssignExtId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddExtensionModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [type, setType] = useState<'upload' | 'store'>('upload');
  const [extName, setExtName] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeUrl, setStoreUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!extName) {
        setExtName(f.name.replace('.zip', '').slice(0, 20));
      }
    }
  };

  const setIconFromFile = (f: File) => {
    if (f.size > 1024 * 1024) {
      setError('Icon file must be less than 1MB');
      return;
    }
    if (!f.type.startsWith('image/')) {
      setError('Only image files (jpg/jpeg/png) are supported');
      return;
    }
    // Revoke previous object URL to avoid memory leaks
    if (iconPreview) {
      URL.revokeObjectURL(iconPreview);
    }
    setIconFile(f);
    setIconPreview(URL.createObjectURL(f));
  };

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setIconFromFile(f);
  };

  const handleIconDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setIconFromFile(f);
  };

  const handleSubmit = async () => {
    if (!extName.trim()) {
      setError('Extension name is required');
      return;
    }

    if (type === 'upload') {
      if (!file) {
        setError('Please select a .zip file');
        return;
      }
      setUploading(true);
      setError(null);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const fileData = Array.from(new Uint8Array(arrayBuffer));
        if (api) {
          await api.uploadExtension(fileData, file.name);
        }
        onSuccess();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to upload extension');
      } finally {
        setUploading(false);
      }
    } else {
      if (!storeUrl.trim()) {
        setError('Please enter a Chrome Web Store URL');
        return;
      }
      setError('Chrome Web Store download is not yet supported. Please use Upload File.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 500, maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Add extension</h3>
          <button className="btn-more" onClick={onClose} style={{ fontSize: 20 }}>✕</button>
        </div>

        {/* Type toggle */}
        <div className="npf-form-row" style={{ marginBottom: 20 }}>
          <label className="npf-label">Type</label>
          <div className="npf-field">
            <div className="toggle-group">
              <button className={`toggle-btn ${type === 'upload' ? 'active' : ''}`} onClick={() => setType('upload')}>Upload File</button>
              <button className={`toggle-btn ${type === 'store' ? 'active' : ''}`} onClick={() => setType('store')}>Chrome Web Store</button>
            </div>
          </div>
        </div>

        {type === 'upload' ? (
          <>
            {/* Installation package */}
            <div className="npf-form-row" style={{ marginBottom: 16 }}>
              <label className="npf-label">Installation package</label>
              <div className="npf-field">
                <button
                  className="btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#4a6cf7', borderColor: '#4a6cf7' }}
                  onClick={handleFileSelect}
                >
                  ☁️ Click to upload
                </button>
                <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileChange} />
                {file && <div style={{ marginTop: 6, fontSize: 12, color: '#1e2a3a' }}>📦 {file.name}</div>}
                <div className="field-hint" style={{ marginTop: 6 }}>
                  Support zip format, limit 60M<br />
                  If the extension file is in crx format, change the file suffix to rar first, unzip it and recompress it to zip format
                </div>
              </div>
            </div>

            {/* Icon */}
            <div className="npf-form-row" style={{ marginBottom: 16 }}>
              <label className="npf-label">Icon</label>
              <div className="npf-field">
                <div
                  className="ext-icon-upload"
                  onClick={() => iconInputRef.current?.click()}
                  onDrop={handleIconDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt="icon" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                  ) : (
                    <>
                      <span style={{ fontSize: 24, color: '#a0c4ff' }}>⬆</span>
                      <span style={{ fontSize: 11, color: '#a0aec0', textAlign: 'center' }}>Drag and drop images or click to upload</span>
                    </>
                  )}
                </div>
                <input ref={iconInputRef} type="file" accept=".jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleIconChange} />
                <div className="field-hint" style={{ marginTop: 6 }}>
                  Optional, at least 60*60 pixels, ratio 1:1, support jpg/jpeg/png format, limit 1M
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Chrome Web Store */
          <div className="npf-form-row" style={{ marginBottom: 16 }}>
            <label className="npf-label" style={{ color: '#ef4444' }}>* URL of Extension</label>
            <div className="npf-field">
              <input
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder="Chrome Web Store URL"
                style={{ borderColor: storeUrl && !storeUrl.includes('chromewebstore.google.com') && !storeUrl.includes('chrome.google.com') ? '#ef4444' : undefined }}
              />
              {storeUrl && !storeUrl.includes('chromewebstore.google.com') && !storeUrl.includes('chrome.google.com') && (
                <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Chrome Web Store URL</div>
              )}
              <div style={{ marginTop: 12, padding: 16, background: '#f7f8fc', borderRadius: 8, fontSize: 13, color: '#6b7b8d' }}>
                <div style={{ marginBottom: 8, fontWeight: 500, color: '#1e2a3a' }}>Note:</div>
                <div>1. Please use a network that can access the Chrome Web Store to add the extension.</div>
                <div>2. This extension is provided by a third party; all rights are reserved by them.</div>
                <div style={{ marginBottom: 8 }}>3. Visit <a href="https://chromewebstore.google.com" target="_blank" rel="noopener noreferrer" style={{ color: '#4a6cf7' }}>Chrome Web Store</a>, and copy the link of the extension you want to add.</div>
                <div style={{ background: '#fff', border: '1px solid #e8ecf1', borderRadius: 8, padding: 10, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ color: '#a0aec0' }}>→</span>
                    <span style={{ color: '#a0aec0' }}>⟳</span>
                    <div style={{ flex: 1, background: '#f0f2f5', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#6b7b8d', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>🔒</span> chromewebstore.google.com/detail/volume-master/jghecgabfgfdldnmbfkhmffcabddioke
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🌐 chrome web store</span>
                    <span style={{ color: '#a0aec0' }}>Discover</span>
                    <span style={{ color: '#4a6cf7', borderBottom: '2px solid #4a6cf7', paddingBottom: 2 }}>Extensions</span>
                    <span style={{ color: '#a0aec0' }}>Themes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Extension Name */}
        <div className="npf-form-row" style={{ marginBottom: 16 }}>
          <label className="npf-label" style={{ color: '#ef4444' }}>* Extension Name</label>
          <div className="npf-field">
            <input
              value={extName}
              onChange={(e) => setExtName(e.target.value.slice(0, 20))}
              placeholder="Required, please fill in the extension name"
              maxLength={20}
            />
            <span className="char-count">{extName.length} / 20</span>
          </div>
        </div>

        {/* Introduction */}
        <div className="npf-form-row" style={{ marginBottom: 20 }}>
          <label className="npf-label">Introduction</label>
          <div className="npf-field">
            <input
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value.slice(0, 200))}
              placeholder="Optional, please fill in the brief description of the extension"
              maxLength={200}
            />
            <span className="char-count">{introduction.length} / 200</span>
          </div>
        </div>

        {error && (
          <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={uploading}>
            {uploading ? '⏳ Uploading...' : 'OK'}
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
