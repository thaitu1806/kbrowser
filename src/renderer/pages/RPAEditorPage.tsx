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

export default function RPAEditorPage() {
  const [script, setScript] = useState<RPAScript>(emptyScript);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(
    Object.fromEntries(ACTION_CATEGORIES.map((c) => [c.name, true]))
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [searchOp, setSearchOp] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

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
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const adsActions = JSON.parse(text);
        if (!Array.isArray(adsActions)) {
          alert('Invalid format: expected JSON array');
          return;
        }
        const converted = importFromAdsPower(adsActions);
        setScript((prev) => ({
          ...prev,
          name: prev.name || file.name.replace('.json', ''),
          actions: [...prev.actions, ...converted],
        }));
        alert(`Imported ${converted.length} actions`);
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };
    input.click();
  };

  const handleExport = () => {
    if (script.actions.length === 0) {
      alert('No actions to export');
      return;
    }
    const adsFormat = exportToAdsPower(script.actions);
    const json = JSON.stringify(adsFormat, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.name || 'rpa-process'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    if (!script.name.trim()) return;
    window.electronAPI?.saveRPAScript?.(script);
    alert(`Đã lưu "${script.name}" với ${script.actions.length} hành động`);
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
                <div
                  key={action.id || index}
                  className={`rpa-step ${dragIndex === index ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== index) { moveAction(dragIndex, index); setDragIndex(index); } }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <div className="rpa-step-handle">⠿</div>
                  <div className="rpa-step-icon">{ACTION_ICONS[action.type] || '▶'}</div>
                  <div className="rpa-step-content">
                    <div className="rpa-step-title">{ACTION_LABELS[action.type] || action.type}</div>
                    <div className="rpa-step-config">
                      {renderActionConfig(action, index, updateAction)}
                    </div>
                  </div>
                  <div className="rpa-step-actions">
                    <button title="Edit" onClick={() => setEditingIndex(index)}>✏️</button>
                    <button title="Duplicate" onClick={() => duplicateAction(index)}>📋</button>
                    <button title="Delete" onClick={() => removeAction(index)}>🗑️</button>
                  </div>
                </div>
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
      {editingIndex !== null && script.actions[editingIndex] && (
        <RPAActionModal
          action={script.actions[editingIndex]}
          onSave={(updated) => {
            updateAction(editingIndex, updated);
            setEditingIndex(null);
          }}
          onCancel={() => setEditingIndex(null)}
        />
      )}
    </div>
  );
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
