import { useState } from 'react';
import type { RPAAction, RPAScript } from '@shared/types';

const ACTION_TYPES: RPAAction['type'][] = ['navigate', 'click', 'type', 'wait', 'scroll', 'screenshot'];

const ACTION_LABELS: Record<RPAAction['type'], string> = {
  navigate: 'Điều hướng',
  click: 'Nhấp chuột',
  type: 'Nhập văn bản',
  wait: 'Chờ',
  scroll: 'Cuộn trang',
  screenshot: 'Chụp màn hình',
};

const DEMO_TEMPLATES = [
  { id: 'tpl-1', name: 'Facebook Login', platform: 'facebook' as const, description: 'Đăng nhập Facebook tự động' },
  { id: 'tpl-2', name: 'Amazon Search', platform: 'amazon' as const, description: 'Tìm kiếm sản phẩm Amazon' },
  { id: 'tpl-3', name: 'TikTok Browse', platform: 'tiktok' as const, description: 'Duyệt TikTok tự động' },
];

const emptyScript: RPAScript = {
  name: '',
  actions: [],
  errorHandling: 'stop',
  maxRetries: 3,
};

export default function RPAEditorPage() {
  const [script, setScript] = useState<RPAScript>(emptyScript);
  const [savedScripts, setSavedScripts] = useState<RPAScript[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addAction = (type: RPAAction['type']) => {
    const newAction: RPAAction = { type, timeout: 5000 };
    setScript((prev) => ({ ...prev, actions: [...prev.actions, newAction] }));
  };

  const updateAction = (index: number, updates: Partial<RPAAction>) => {
    setScript((prev) => ({
      ...prev,
      actions: prev.actions.map((a, i) => (i === index ? { ...a, ...updates } : a)),
    }));
  };

  const removeAction = (index: number) => {
    setScript((prev) => ({ ...prev, actions: prev.actions.filter((_, i) => i !== index) }));
  };

  const moveAction = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setScript((prev) => {
      const actions = [...prev.actions];
      const [moved] = actions.splice(fromIndex, 1);
      actions.splice(toIndex, 0, moved);
      return { ...prev, actions };
    });
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      moveAction(dragIndex, index);
      setDragIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const handleSave = () => {
    if (!script.name.trim()) return;
    // TODO: IPC call — window.electronAPI.saveRPAScript(script)
    const saved = { ...script, id: `rpa-${Date.now()}` };
    setSavedScripts((prev) => [...prev, saved]);
    setScript(emptyScript);
  };

  const handleLoadTemplate = (templateId: string) => {
    // TODO: IPC call — window.electronAPI.loadRPATemplate(templateId)
    const template = DEMO_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setScript({
        name: `${template.name} (copy)`,
        actions: [
          { type: 'navigate', value: `https://${template.platform}.com`, timeout: 10000 },
          { type: 'wait', timeout: 2000 },
          { type: 'screenshot' },
        ],
        errorHandling: 'skip',
        maxRetries: 3,
      });
    }
  };

  const handleExecute = () => {
    // TODO: IPC call — window.electronAPI.executeRPAScript(profileId, script)
    alert(`Thực thi kịch bản "${script.name}" với ${script.actions.length} hành động`);
  };

  return (
    <div className="page">
      <h2>Trình soạn RPA kéo-thả</h2>

      {/* Templates */}
      <div className="section">
        <h3>Mẫu tự động hóa</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {DEMO_TEMPLATES.map((tpl) => (
            <button key={tpl.id} className="btn btn-sm" onClick={() => handleLoadTemplate(tpl.id)}>
              {tpl.name} ({tpl.platform})
            </button>
          ))}
        </div>
      </div>

      {/* Script config */}
      <div className="section">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="script-name">Tên kịch bản</label>
            <input
              id="script-name"
              value={script.name}
              onChange={(e) => setScript({ ...script, name: e.target.value })}
              placeholder="Nhập tên kịch bản..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="error-handling">Xử lý lỗi</label>
            <select
              id="error-handling"
              value={script.errorHandling}
              onChange={(e) => setScript({ ...script, errorHandling: e.target.value as 'stop' | 'skip' | 'retry' })}
            >
              <option value="stop">Dừng ngay (Stop)</option>
              <option value="skip">Bỏ qua (Skip)</option>
              <option value="retry">Thử lại (Retry)</option>
            </select>
          </div>
        </div>
        {script.errorHandling === 'retry' && (
          <div className="form-group">
            <label htmlFor="max-retries">Số lần thử lại tối đa</label>
            <input
              id="max-retries"
              type="number"
              min={1}
              max={10}
              value={script.maxRetries ?? 3}
              onChange={(e) => setScript({ ...script, maxRetries: parseInt(e.target.value) || 3 })}
            />
          </div>
        )}
      </div>

      {/* Action palette */}
      <div className="section">
        <h3>Thêm hành động</h3>
        <div className="rpa-palette">
          {ACTION_TYPES.map((type) => (
            <button key={type} onClick={() => addAction(type)}>
              + {ACTION_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="section">
        <h3>Kịch bản ({script.actions.length} hành động)</h3>
        <div className="rpa-canvas">
          {script.actions.length === 0 ? (
            <div className="empty-state">
              <p>Kéo-thả hoặc nhấn nút để thêm hành động</p>
            </div>
          ) : (
            script.actions.map((action, index) => (
              <div
                key={index}
                className="rpa-block"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{ opacity: dragIndex === index ? 0.5 : 1 }}
              >
                <span style={{ color: '#999', fontSize: '0.75rem', minWidth: '20px' }}>#{index + 1}</span>
                <span className="block-type">{ACTION_LABELS[action.type]}</span>
                <div className="block-config" style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
                  {(action.type === 'navigate' || action.type === 'click' || action.type === 'type' || action.type === 'scroll') && (
                    <input
                      style={{ flex: 1, padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '3px', fontSize: '0.8rem' }}
                      placeholder={action.type === 'navigate' ? 'URL...' : 'CSS selector...'}
                      value={action.type === 'navigate' ? (action.value ?? '') : (action.selector ?? '')}
                      onChange={(e) =>
                        updateAction(index, action.type === 'navigate' ? { value: e.target.value } : { selector: e.target.value })
                      }
                    />
                  )}
                  {action.type === 'type' && (
                    <input
                      style={{ flex: 1, padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '3px', fontSize: '0.8rem' }}
                      placeholder="Văn bản nhập..."
                      value={action.value ?? ''}
                      onChange={(e) => updateAction(index, { value: e.target.value })}
                    />
                  )}
                  {action.type === 'wait' && (
                    <input
                      style={{ width: '80px', padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '3px', fontSize: '0.8rem' }}
                      type="number"
                      placeholder="ms"
                      value={action.timeout ?? 1000}
                      onChange={(e) => updateAction(index, { timeout: parseInt(e.target.value) || 1000 })}
                    />
                  )}
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeAction(index)}
                  style={{ flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={!script.name.trim()}>
          Lưu kịch bản
        </button>
        <button className="btn btn-success" onClick={handleExecute} disabled={script.actions.length === 0}>
          ▶ Thực thi
        </button>
      </div>

      {/* Saved scripts */}
      {savedScripts.length > 0 && (
        <div className="section" style={{ marginTop: '1.5rem' }}>
          <h3>Kịch bản đã lưu</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Số hành động</th>
                  <th>Xử lý lỗi</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {savedScripts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.actions.length}</td>
                    <td>{s.errorHandling}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setScript(s)}>Tải</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
