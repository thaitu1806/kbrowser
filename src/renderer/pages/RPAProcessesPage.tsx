import { useState, useEffect } from 'react';
import type { RPAScript } from '@shared/types';

interface Props {
  onCreateProcess: () => void;
  onEditProcess: (script: RPAScript) => void;
}

export default function RPAProcessesPage({ onCreateProcess, onEditProcess }: Props) {
  const [scripts, setScripts] = useState<RPAScript[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadScripts = async () => {
    try {
      const api = window.electronAPI;
      if (api?.listRPAScripts) {
        const list = await api.listRPAScripts();
        setScripts(list);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadScripts(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this process?')) return;
    try {
      await window.electronAPI?.deleteRPAScript?.(id);
      setScripts((prev) => prev.filter((s) => s.id !== id));
    } catch { /* ignore */ }
  };

  const filtered = scripts.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="rpa-processes-page">
      {/* Header */}
      <div className="rpa-proc-header">
        <h2>Processes</h2>
        <span className="rpa-proc-count">Created processes: {scripts.length} / 500</span>
      </div>

      {/* Toolbar */}
      <div className="rpa-proc-toolbar">
        <button className="btn btn-primary" onClick={onCreateProcess}>
          ＋ Create a process
        </button>
        <select style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
          <option>All</option>
        </select>
        <div className="search-box" style={{ maxWidth: 200 }}>
          <span className="search-icon">🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
        </div>
      </div>

      {/* List */}
      <div className="rpa-proc-list">
        {loading ? (
          <div className="rpa-empty">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="rpa-empty">
            {scripts.length === 0 ? 'No processes yet. Click "Create a process" to start.' : 'No matching processes.'}
          </div>
        ) : (
          <div className="rpa-proc-grid">
            {filtered.map((script) => (
              <div key={script.id} className="rpa-proc-card">
                <div className="rpa-proc-card-body" onClick={() => onEditProcess(script)}>
                  <div className="rpa-proc-card-icon">📄</div>
                  <div className="rpa-proc-card-name">{script.name}</div>
                  <div className="rpa-proc-card-remark">
                    {script.actions.length} actions · {script.errorHandling}
                  </div>
                </div>
                <div className="rpa-proc-card-actions">
                  <button title="Edit" onClick={() => onEditProcess(script)}>✏️</button>
                  <button title="Duplicate" onClick={() => {
                    const copy = { ...script, id: undefined, name: `${script.name} (copy)` };
                    window.electronAPI?.saveRPAScript?.(copy).then(() => loadScripts());
                  }}>📋</button>
                  <button title="Delete" onClick={() => script.id && handleDelete(script.id)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
