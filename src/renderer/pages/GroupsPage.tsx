import { useState, useEffect, useCallback } from 'react';

const api = typeof window !== 'undefined' ? window.electronAPI : null;

interface Group {
  id: string;
  name: string;
  remark: string | null;
  created_at: string;
}

export default function GroupsPage({ onNavigateToGroup }: { onNavigateToGroup?: (groupName: string) => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRemark, setNewRemark] = useState('');
  const [nameError, setNameError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');

  const loadGroups = useCallback(async () => {
    if (api) {
      const list = await api.listGroups();
      setGroups(list);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setNameError('Group name cannot be empty');
      return;
    }
    setNameError('');
    try {
      if (api) {
        await api.createGroup(newName.trim(), newRemark.trim() || undefined);
        await loadGroups();
      }
      setShowCreate(false);
      setNewName('');
      setNewRemark('');
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this group?')) return;
    if (api) {
      await api.deleteGroup(id);
      await loadGroups();
    }
  };

  const handleRenameStart = (group: Group) => {
    setRenamingId(group.id);
    setRenameValue(group.name);
    setRenameError('');
  };

  const handleRenameSave = async () => {
    if (!renamingId) return;
    if (!renameValue.trim()) {
      setRenameError('Group name cannot be empty');
      return;
    }
    setRenameError('');
    try {
      if (api) {
        await api.renameGroup(renamingId, renameValue.trim());
        await loadGroups();
      }
      setRenamingId(null);
      setRenameValue('');
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename group');
    }
  };

  return (
    <div className="page" style={{ padding: 20 }}>
      <div className="section-header">
        <h2>Groups</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Group</button>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state"><p>No groups yet.</p></div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Remark</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <span
                      className="group-link"
                      style={{ cursor: 'pointer', color: '#4a6cf7', fontWeight: 500, textDecoration: 'underline' }}
                      onClick={() => onNavigateToGroup?.(g.name)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') onNavigateToGroup?.(g.name); }}
                    >
                      {g.name}
                    </span>
                  </td>
                  <td>{g.remark || '—'}</td>
                  <td>{new Date(g.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-sm" onClick={() => handleRenameStart(g)}>Rename</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(g.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Group Dialog */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>New group</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }} onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="npf-form-row">
              <label className="npf-label" style={{ color: nameError ? '#ef4444' : undefined }}>* Group name</label>
              <div className="npf-field">
                <input
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setNameError(''); }}
                  placeholder="Please enter a new group name"
                  maxLength={30}
                  style={{ borderColor: nameError ? '#ef4444' : undefined }}
                />
                <span className="char-count">{newName.length} / 30</span>
                {nameError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{nameError}</div>}
              </div>
            </div>
            <div className="npf-form-row">
              <label className="npf-label">Remark</label>
              <div className="npf-field">
                <input
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  placeholder="Enter remark"
                  maxLength={200}
                />
                <span className="char-count">{newRemark.length} / 200</span>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={handleCreate}>OK</button>
              <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Group Dialog */}
      {renamingId && (
        <div className="modal-overlay" onClick={() => setRenamingId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Rename group</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }} onClick={() => setRenamingId(null)}>✕</button>
            </div>
            <div className="npf-form-row">
              <label className="npf-label" style={{ color: renameError ? '#ef4444' : undefined }}>* New name</label>
              <div className="npf-field">
                <input
                  value={renameValue}
                  onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
                  placeholder="Enter new group name"
                  maxLength={30}
                  style={{ borderColor: renameError ? '#ef4444' : undefined }}
                />
                <span className="char-count">{renameValue.length} / 30</span>
                {renameError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{renameError}</div>}
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={handleRenameSave}>Save</button>
              <button className="btn" onClick={() => setRenamingId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
