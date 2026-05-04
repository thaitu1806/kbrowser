import { useState } from 'react';
import type { RPAAction, RPAActionType, RPAScript } from '@shared/types';
import RPAActionModal from '../components/RPAActionModal';
import { importFromAdsPower, exportToAdsPower } from '../utils/rpa-converter';

/** All action categories for the operations panel */
const ACTION_CATEGORIES = [
  {
    name: 'Web Actions',
    icon: '🌐',
    actions: [
      { type: 'newTab' as RPAActionType, label: 'New Tab' },
      { type: 'closeTab' as RPAActionType, label: 'Close Tab' },
      { type: 'closeOtherTabs' as RPAActionType, label: 'Close Other Tabs' },
      { type: 'switchTab' as RPAActionType, label: 'Switch Tabs' },
      { type: 'accessWebsite' as RPAActionType, label: 'Access Website' },
      { type: 'refreshWebpage' as RPAActionType, label: 'Refresh Webpage' },
      { type: 'goBack' as RPAActionType, label: 'Go Back' },
      { type: 'screenshot' as RPAActionType, label: 'Screenshot' },
      { type: 'hover' as RPAActionType, label: 'Hover' },
    ],
  },
  {
    name: 'Element Actions',
    icon: '🖱️',
    actions: [
      { type: 'dropdown' as RPAActionType, label: 'Drop-down' },
      { type: 'focus' as RPAActionType, label: 'Focus' },
      { type: 'click' as RPAActionType, label: 'Click' },
      { type: 'input' as RPAActionType, label: 'Input' },
      { type: 'scroll' as RPAActionType, label: 'Scroll' },
      { type: 'inputFile' as RPAActionType, label: 'Input File' },
      { type: 'executeJS' as RPAActionType, label: 'Execute JavaScript' },
    ],
  },
  {
    name: 'Keyboard Actions',
    icon: '⌨️',
    actions: [
      { type: 'keys' as RPAActionType, label: 'Keys' },
      { type: 'keyCombination' as RPAActionType, label: 'Key Combination' },
    ],
  },
  {
    name: 'Waits',
    icon: '⏳',
    actions: [
      { type: 'waitTime' as RPAActionType, label: 'Time' },
      { type: 'waitElement' as RPAActionType, label: 'Element Appears' },
      { type: 'waitRequest' as RPAActionType, label: 'Request to Finish' },
    ],
  },
  {
    name: 'Get Data',
    icon: '📋',
    actions: [
      { type: 'getURL' as RPAActionType, label: 'URL' },
      { type: 'getClipboard' as RPAActionType, label: 'Clipboard Content' },
      { type: 'getElement' as RPAActionType, label: 'Element' },
      { type: 'getFocusedElement' as RPAActionType, label: 'Focused Element' },
      { type: 'saveTxt' as RPAActionType, label: 'Save to Txt' },
    ],
  },
  {
    name: 'Flow Control',
    icon: '🔄',
    actions: [
      { type: 'forLoop' as RPAActionType, label: 'For Loop Times' },
      { type: 'ifCondition' as RPAActionType, label: 'If Condition' },
    ],
  },
];

/** Labels for all action types */
const ACTION_LABELS: Record<RPAActionType, string> = {} as Record<RPAActionType, string>;
ACTION_CATEGORIES.forEach((cat) => cat.actions.forEach((a) => { ACTION_LABELS[a.type] = a.label; }));

/** Icon for each action type */
const ACTION_ICONS: Partial<Record<RPAActionType, string>> = {
  newTab: '➕', closeTab: '✖️', closeOtherTabs: '🗂️', switchTab: '🔀',
  accessWebsite: '🌍', refreshWebpage: '🔄', goBack: '⬅️', screenshot: '📸', hover: '👆',
  dropdown: '📋', focus: '🎯', click: '🖱️', input: '✏️', scroll: '📜',
  inputFile: '📁', executeJS: '💻',
  keys: '⌨️', keyCombination: '🎹',
  waitTime: '⏱️', waitElement: '👁️', waitRequest: '📡',
  getURL: '🔗', getClipboard: '📎', getElement: '🏷️', getFocusedElement: '🎯', saveTxt: '💾',
  forLoop: '🔁', ifCondition: '❓',
};

const createAction = (type: RPAActionType): RPAAction => {
  const base: RPAAction = { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type, timeout: 10000 };
  switch (type) {
    case 'accessWebsite': return { ...base, value: 'https://' };
    case 'waitTime': return { ...base, timeout: 2000 };
    case 'waitElement': return { ...base, selector: '', timeout: 10000 };
    case 'waitRequest': return { ...base, timeout: 10000 };
    case 'click': case 'focus': case 'hover': case 'dropdown':
      return { ...base, selector: '' };
    case 'input': return { ...base, selector: '', value: '' };
    case 'scroll': return { ...base, direction: 'down', distance: 500 };
    case 'forLoop': return { ...base, times: 5, loopVariable: 'for_times_index', children: [] };
    case 'ifCondition': return { ...base, condition: '', children: [] };
    case 'keys': return { ...base, value: '' };
    case 'keyCombination': return { ...base, keys: ['Ctrl'] };
    case 'executeJS': return { ...base, value: '' };
    case 'switchTab': return { ...base, tabIndex: 0 };
    default: return base;
  }
};

const emptyScript: RPAScript = {
  name: '',
  group: 'Ungrouped',
  actions: [],
  errorHandling: 'stop',
  maxRetries: 3,
  afterTaskAction: 'none',
};

interface RPAEditorProps {
  initialScript?: RPAScript | null;
  onBack?: () => void;
}

export default function RPAEditorPage({ initialScript, onBack }: RPAEditorProps) {
  const [script, setScript] = useState<RPAScript>(initialScript || emptyScript);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(
    Object.fromEntries(ACTION_CATEGORIES.map((c) => [c.name, true]))
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [searchOp, setSearchOp] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('replace');

  const addAction = (type: RPAActionType) => {
    setScript((prev) => ({ ...prev, actions: [...prev.actions, createAction(type)] }));
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

  const duplicateAction = (index: number) => {
    setScript((prev) => {
      const copy = { ...prev.actions[index], id: `act-${Date.now()}` };
      const actions = [...prev.actions];
      actions.splice(index + 1, 0, copy);
      return { ...prev, actions };
    });
  };

  const moveAction = (from: number, to: number) => {
    if (from === to) return;
    setScript((prev) => {
      const actions = [...prev.actions];
      const [moved] = actions.splice(from, 1);
      actions.splice(to, 0, moved);
      return { ...prev, actions };
    });
  };

  const toggleCat = (name: string) => {
    setExpandedCats((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleImport = () => {
    setImportJson('');
    setImportMode('replace');
    setShowImportModal(true);
  };

  const handleImportConfirm = () => {
    try {
      const adsActions = JSON.parse(importJson);
      if (!Array.isArray(adsActions)) {
        alert('Invalid format: expected JSON array');
        return;
      }
      const converted = importFromAdsPower(adsActions);
      if (importMode === 'replace') {
        setScript((prev) => ({ ...prev, actions: converted }));
      } else {
        setScript((prev) => ({ ...prev, actions: [...prev.actions, ...converted] }));
      }
      setShowImportModal(false);
      setImportJson('');
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
    }
  };

  const handleExport = () => {
    setShowExportModal(true);
  };

  const getExportJson = () => {
    if (script.actions.length === 0) return '[]';
    return JSON.stringify(exportToAdsPower(script.actions), null, 2);
  };

  const handleSave = async () => {
    if (!script.name.trim()) {
      alert('Please enter a process name');
      return;
    }
    try {
      const api = window.electronAPI;
      if (api?.saveRPAScript) {
        const id = await api.saveRPAScript(script);
        setScript((prev) => ({ ...prev, id }));
        if (onBack) onBack();
        else alert(`Saved "${script.name}" successfully`);
      } else {
        alert('Save not available in dev mode');
      }
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleExecute = () => {
    alert(`Thực thi "${script.name}" với ${script.actions.length} hành động`);
  };

  const filteredCategories = ACTION_CATEGORIES.map((cat) => ({
    ...cat,
    actions: searchOp
      ? cat.actions.filter((a) => a.label.toLowerCase().includes(searchOp.toLowerCase()))
      : cat.actions,
  })).filter((cat) => cat.actions.length > 0);

  return (
    <div className="rpa-editor">
      {/* Left: Operations Panel */}
      <div className="rpa-operations">
        <h3>Operations</h3>
        <input
          className="rpa-search"
          placeholder="Search for operations"
          value={searchOp}
          onChange={(e) => setSearchOp(e.target.value)}
        />
        <div className="rpa-categories">
          {filteredCategories.map((cat) => (
            <div key={cat.name} className="rpa-category">
              <div className="rpa-category-header" onClick={() => toggleCat(cat.name)}>
                <span>{cat.icon} {cat.name}</span>
                <span className="rpa-chevron">{expandedCats[cat.name] ? '▾' : '▸'}</span>
              </div>
              {expandedCats[cat.name] && (
                <div className="rpa-category-items">
                  {cat.actions.map((action) => (
                    <button
                      key={action.type}
                      className="rpa-op-btn"
                      onClick={() => addAction(action.type)}
                    >
                      <span>{action.label}</span>
                      <span className="rpa-op-add">＋</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Process Canvas */}
      <div className="rpa-canvas-area">
        {/* Header */}
        <div className="rpa-header">
          <div className="rpa-header-actions">
            <button className="btn btn-sm" onClick={() => alert('Debug')}>⚙ Debug</button>
            <button className="btn btn-sm" onClick={handleImport}>📥 Import</button>
            <button className="btn btn-sm" onClick={handleExport}>📤 Export</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>💾 Save</button>
          </div>
        </div>

        {/* Script Config */}
        <div className="rpa-config">
          <div className="rpa-config-row">
            <label>Process name</label>
            <input
              value={script.name}
              onChange={(e) => setScript({ ...script, name: e.target.value })}
              placeholder="Enter process name..."
            />
          </div>
          <div className="rpa-config-row">
            <label>Select group</label>
            <select value={script.group} onChange={(e) => setScript({ ...script, group: e.target.value })}>
              <option value="Ungrouped">Ungrouped</option>
            </select>
          </div>
          <div className="rpa-config-row">
            <label>On-error</label>
            <select
              value={script.errorHandling}
              onChange={(e) => setScript({ ...script, errorHandling: e.target.value as 'stop' | 'skip' | 'retry' })}
            >
              <option value="stop">Stop</option>
              <option value="skip">Skip</option>
              <option value="retry">Retry</option>
            </select>
          </div>
          <div className="rpa-config-row">
            <label>After task</label>
            <select
              value={script.afterTaskAction}
              onChange={(e) => setScript({ ...script, afterTaskAction: e.target.value as 'clearTab' | 'quitBrowser' | 'none' })}
            >
              <option value="none">None</option>
              <option value="clearTab">Clear tab</option>
              <option value="quitBrowser">Quit Browser</option>
            </select>
          </div>
        </div>

        {/* Process Steps */}
        <div className="rpa-process">
          <div className="rpa-process-header">
            <span>Process ({script.actions.length})</span>
          </div>
          <div className="rpa-steps">
            {script.actions.length === 0 ? (
              <div className="rpa-empty">
                <p>Click an operation from the left panel to add steps</p>
              </div>
            ) : (
              script.actions.map((action, index) => (
                <RPAStepItem
                  key={action.id || index}
                  action={action}
                  index={index}
                  dragIndex={dragIndex}
                  setDragIndex={setDragIndex}
                  moveAction={moveAction}
                  updateAction={updateAction}
                  removeAction={removeAction}
                  duplicateAction={duplicateAction}
                  setEditingIndex={setEditingIndex}
                  onAddChild={(parentIndex, type) => {
                    setScript((prev) => {
                      const actions = [...prev.actions];
                      const parent = { ...actions[parentIndex] };
                      parent.children = [...(parent.children || []), createAction(type)];
                      actions[parentIndex] = parent;
                      return { ...prev, actions };
                    });
                  }}
                  onUpdateChild={(parentIndex, childIndex, updates) => {
                    setScript((prev) => {
                      const actions = [...prev.actions];
                      const parent = { ...actions[parentIndex] };
                      parent.children = (parent.children || []).map((c, ci) => ci === childIndex ? { ...c, ...updates } : c);
                      actions[parentIndex] = parent;
                      return { ...prev, actions };
                    });
                  }}
                  onRemoveChild={(parentIndex, childIndex) => {
                    setScript((prev) => {
                      const actions = [...prev.actions];
                      const parent = { ...actions[parentIndex] };
                      parent.children = (parent.children || []).filter((_, ci) => ci !== childIndex);
                      actions[parentIndex] = parent;
                      return { ...prev, actions };
                    });
                  }}
                  onDuplicateChild={(parentIndex, childIndex) => {
                    setScript((prev) => {
                      const actions = [...prev.actions];
                      const parent = { ...actions[parentIndex] };
                      const children = [...(parent.children || [])];
                      const copy = { ...children[childIndex], id: `act-${Date.now()}` };
                      children.splice(childIndex + 1, 0, copy);
                      parent.children = children;
                      actions[parentIndex] = parent;
                      return { ...prev, actions };
                    });
                  }}
                  onEditChild={(parentIndex, childIndex) => {
                    // Store parent+child index for modal editing
                    setEditingIndex(parentIndex * 1000 + childIndex + 1);
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* Execute */}
        <div className="rpa-footer">
          <button className="btn btn-success" onClick={handleExecute} disabled={script.actions.length === 0}>
            ▶ Execute
          </button>
        </div>
      </div>

      {/* Action Config Modal */}
      {editingIndex !== null && editingIndex < 1000 && script.actions[editingIndex] && (
        <RPAActionModal
          action={script.actions[editingIndex]}
          onSave={(updated) => {
            updateAction(editingIndex, updated);
            setEditingIndex(null);
          }}
          onCancel={() => setEditingIndex(null)}
        />
      )}
      {/* Child Action Modal */}
      {editingIndex !== null && editingIndex >= 1000 && (() => {
        const parentIdx = Math.floor(editingIndex / 1000);
        const childIdx = (editingIndex % 1000) - 1;
        const parent = script.actions[parentIdx];
        const child = parent?.children?.[childIdx];
        if (!child) return null;
        return (
          <RPAActionModal
            action={child}
            onSave={(updated) => {
              setScript((prev) => {
                const actions = [...prev.actions];
                const p = { ...actions[parentIdx] };
                p.children = (p.children || []).map((c, ci) => ci === childIdx ? { ...c, ...updated } : c);
                actions[parentIdx] = p;
                return { ...prev, actions };
              });
              setEditingIndex(null);
            }}
            onCancel={() => setEditingIndex(null)}
          />
        );
      })()}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content rpa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import</h3>
              <button className="modal-close" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="rpa-modal-field">
                <label>Process JSON</label>
                <textarea
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder="Please paste the JSON of the corresponding process here"
                  rows={10}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px', border: importJson && !isValidJson(importJson) ? '2px solid var(--danger)' : undefined }}
                />
              </div>
              <div className="rpa-modal-field">
                <label>Imported content</label>
                <div className="rpa-radio-row">
                  <label><input type="radio" checked={importMode === 'append'} onChange={() => setImportMode('append')} /> Append</label>
                  <label><input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace</label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleImportConfirm} disabled={!importJson.trim()}>OK</button>
              <button className="btn" onClick={() => setShowImportModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal-content rpa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Export</h3>
              <button className="modal-close" onClick={() => setShowExportModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="rpa-modal-field">
                <label>Process JSON</label>
                <textarea
                  value={getExportJson()}
                  readOnly
                  rows={14}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '11px', background: '#f9fafb' }}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => {
                navigator.clipboard.writeText(getExportJson());
                setShowExportModal(false);
              }}>📋 Copy</button>
              <button className="btn" onClick={() => setShowExportModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/** Step item component — supports nested children for ForLoop */
function RPAStepItem({ action, index, dragIndex, setDragIndex, moveAction, updateAction, removeAction, duplicateAction, setEditingIndex, onAddChild, onUpdateChild, onRemoveChild, onDuplicateChild, onEditChild }: {
  action: RPAAction; index: number; dragIndex: number | null;
  setDragIndex: (i: number | null) => void; moveAction: (f: number, t: number) => void;
  updateAction: (i: number, u: Partial<RPAAction>) => void; removeAction: (i: number) => void;
  duplicateAction: (i: number) => void; setEditingIndex: (i: number) => void;
  onAddChild: (parentIndex: number, type: RPAActionType) => void;
  onUpdateChild: (parentIndex: number, childIndex: number, updates: Partial<RPAAction>) => void;
  onRemoveChild: (parentIndex: number, childIndex: number) => void;
  onDuplicateChild: (parentIndex: number, childIndex: number) => void;
  onEditChild: (parentIndex: number, childIndex: number) => void;
}) {
  const hasChildren = action.type === 'forLoop' || action.type === 'ifCondition';
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`rpa-step-wrapper ${hasChildren ? 'has-children' : ''}`}>
      <div
        className={`rpa-step ${dragIndex === index ? 'dragging' : ''} ${hasChildren ? 'rpa-step-parent' : ''}`}
        draggable
        onDragStart={() => setDragIndex(index)}
        onDragOver={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== index) { moveAction(dragIndex, index); setDragIndex(index); } }}
        onDragEnd={() => setDragIndex(null)}
      >
        {hasChildren && (
          <button className="rpa-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        <div className="rpa-step-handle">⠿</div>
        <div className="rpa-step-icon">{ACTION_ICONS[action.type] || '▶'}</div>
        <div className="rpa-step-content">
          <div className="rpa-step-title">{ACTION_LABELS[action.type] || action.type}</div>
          <div className="rpa-step-config">
            {hasChildren ? (
              <span className="rpa-step-summary">
                {action.type === 'forLoop' && <>Times: <b>{action.times || 5}</b> , Save loop element index to: <b>{action.loopVariable || 'for_times_index'}</b></>}
                {action.type === 'ifCondition' && <>Condition: <b>{action.condition || '...'}</b></>}
              </span>
            ) : (
              renderActionConfig(action, index, updateAction)
            )}
          </div>
        </div>
        <div className="rpa-step-actions">
          <button title="Edit" onClick={() => setEditingIndex(index)}>✏️</button>
          <button title="Duplicate" onClick={() => duplicateAction(index)}>📋</button>
          <button title="Delete" onClick={() => removeAction(index)}>🗑️</button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && !collapsed && (
        <div className="rpa-children">
          <div className="rpa-children-hint">
            Process drag performed this region [{ACTION_LABELS[action.type]}] subtask
          </div>
          {(action.children || []).map((child, childIdx) => (
            <div key={child.id || childIdx} className="rpa-step rpa-step-child">
              <div className="rpa-step-handle">⠿</div>
              <div className="rpa-step-icon">{ACTION_ICONS[child.type] || '▶'}</div>
              <div className="rpa-step-content">
                <div className="rpa-step-title">{ACTION_LABELS[child.type] || child.type}</div>
                <div className="rpa-step-config">
                  {renderActionConfig(child, childIdx, (ci, u) => onUpdateChild(index, ci, u))}
                </div>
              </div>
              <div className="rpa-step-actions">
                <button title="Edit" onClick={() => onEditChild(index, childIdx)}>✏️</button>
                <button title="Duplicate" onClick={() => onDuplicateChild(index, childIdx)}>📋</button>
                <button title="Delete" onClick={() => onRemoveChild(index, childIdx)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Check if string is valid JSON */
function isValidJson(str: string): boolean {
  try { JSON.parse(str); return true; } catch { return false; }
}

/** Render inline config fields for each action type */
function renderActionConfig(
  action: RPAAction,
  index: number,
  update: (i: number, u: Partial<RPAAction>) => void,
) {
  switch (action.type) {
    case 'accessWebsite':
      return (
        <div className="rpa-fields">
          <label>Access URL</label>
          <input value={action.value || ''} onChange={(e) => update(index, { value: e.target.value })} placeholder="https://..." />
          <label>Timeout waiting</label>
          <input type="number" value={action.timeout || 10000} onChange={(e) => update(index, { timeout: parseInt(e.target.value) || 10000 })} />
          <span className="rpa-unit">Millisecond</span>
        </div>
      );
    case 'click': case 'focus': case 'hover': case 'dropdown':
      return (
        <div className="rpa-fields">
          <label>Selector</label>
          <input value={action.selector || ''} onChange={(e) => update(index, { selector: e.target.value })} placeholder="CSS selector..." />
        </div>
      );
    case 'input':
      return (
        <div className="rpa-fields">
          <label>Selector</label>
          <input value={action.selector || ''} onChange={(e) => update(index, { selector: e.target.value })} placeholder="CSS selector..." />
          <label>Text</label>
          <input value={action.value || ''} onChange={(e) => update(index, { value: e.target.value })} placeholder="Text to input..." />
        </div>
      );
    case 'waitTime':
      return (
        <div className="rpa-fields">
          <label>Wait</label>
          <input type="number" value={action.timeout || 2000} onChange={(e) => update(index, { timeout: parseInt(e.target.value) || 2000 })} />
          <span className="rpa-unit">ms</span>
        </div>
      );
    case 'waitElement':
      return (
        <div className="rpa-fields">
          <label>Selector</label>
          <input value={action.selector || ''} onChange={(e) => update(index, { selector: e.target.value })} placeholder="CSS selector..." />
          <label>Timeout</label>
          <input type="number" value={action.timeout || 10000} onChange={(e) => update(index, { timeout: parseInt(e.target.value) || 10000 })} />
          <span className="rpa-unit">ms</span>
        </div>
      );
    case 'waitRequest':
      return (
        <div className="rpa-fields">
          <label>Timeout</label>
          <input type="number" value={action.timeout || 10000} onChange={(e) => update(index, { timeout: parseInt(e.target.value) || 10000 })} />
          <span className="rpa-unit">ms</span>
        </div>
      );
    case 'scroll':
      return (
        <div className="rpa-fields">
          <label>Direction</label>
          <select value={action.direction || 'down'} onChange={(e) => update(index, { direction: e.target.value as 'up' | 'down' })}>
            <option value="down">Down</option>
            <option value="up">Up</option>
          </select>
          <label>Distance</label>
          <input type="number" value={action.distance || 500} onChange={(e) => update(index, { distance: parseInt(e.target.value) || 500 })} />
          <span className="rpa-unit">px</span>
        </div>
      );
    case 'forLoop':
      return (
        <div className="rpa-fields">
          <label>Times</label>
          <input type="number" value={action.times || 5} onChange={(e) => update(index, { times: parseInt(e.target.value) || 1 })} />
          <label>Save loop index to</label>
          <input value={action.loopVariable || 'for_times_index'} onChange={(e) => update(index, { loopVariable: e.target.value })} />
        </div>
      );
    case 'executeJS':
      return (
        <div className="rpa-fields">
          <label>JavaScript code</label>
          <textarea
            value={action.value || ''}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder="// Your JavaScript code here..."
            rows={3}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>
      );
    case 'keys':
      return (
        <div className="rpa-fields">
          <label>Key</label>
          <input value={action.value || ''} onChange={(e) => update(index, { value: e.target.value })} placeholder="Enter, Tab, Escape..." />
        </div>
      );
    case 'keyCombination':
      return (
        <div className="rpa-fields">
          <label>Keys</label>
          <input value={(action.keys || []).join('+')} onChange={(e) => update(index, { keys: e.target.value.split('+') })} placeholder="Ctrl+C, Ctrl+V..." />
        </div>
      );
    case 'switchTab':
      return (
        <div className="rpa-fields">
          <label>Tab index</label>
          <input type="number" value={action.tabIndex || 0} onChange={(e) => update(index, { tabIndex: parseInt(e.target.value) || 0 })} />
        </div>
      );
    case 'getElement':
      return (
        <div className="rpa-fields">
          <label>Selector</label>
          <input value={action.selector || ''} onChange={(e) => update(index, { selector: e.target.value })} placeholder="CSS selector..." />
        </div>
      );
    case 'getURL': case 'getClipboard': case 'getFocusedElement':
    case 'newTab': case 'closeTab': case 'closeOtherTabs':
    case 'refreshWebpage': case 'goBack': case 'screenshot':
    case 'inputFile': case 'saveTxt': case 'ifCondition':
      return <div className="rpa-fields"><span className="rpa-hint">No configuration needed</span></div>;
    default:
      return null;
  }
}
