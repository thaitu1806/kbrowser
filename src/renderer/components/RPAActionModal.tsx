import { useState } from 'react';
import type { RPAAction, RPAActionType } from '@shared/types';

interface Props {
  action: RPAAction;
  onSave: (action: RPAAction) => void;
  onCancel: () => void;
}

const TITLES: Partial<Record<RPAActionType, string>> = {
  accessWebsite: 'Access Website', click: 'Click', input: 'Input', scroll: 'Scroll',
  waitTime: 'Time', waitElement: 'Element Appears', waitRequest: 'Request to Finish',
  forLoop: 'For Loop Times', hover: 'Hover', focus: 'Focus', dropdown: 'Drop-down',
  keys: 'Keys', keyCombination: 'Key Combination', executeJS: 'Execute JavaScript',
  screenshot: 'Screenshot', newTab: 'New Tab', closeTab: 'Close Tab',
  closeOtherTabs: 'Close Other Tabs', switchTab: 'Switch Tabs',
  refreshWebpage: 'Refresh Webpage', goBack: 'Go Back', inputFile: 'Input File',
  getURL: 'Get URL', getClipboard: 'Get Clipboard', getElement: 'Get Element',
  getFocusedElement: 'Get Focused Element', saveTxt: 'Save to Txt', ifCondition: 'If Condition',
};

export default function RPAActionModal({ action, onSave, onCancel }: Props) {
  const [data, setData] = useState<RPAAction>({ ...action });
  const set = (updates: Partial<RPAAction>) => setData((prev) => ({ ...prev, ...updates }));

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content rpa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{TITLES[data.type] || data.type}</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          {renderFields(data, set)}
          <div className="rpa-modal-field">
            <label>Description</label>
            <input
              value={data.description || ''}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Optional"
              maxLength={100}
            />
            <span className="rpa-char-count">{(data.description || '').length} / 100</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={() => onSave(data)}>OK</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function renderFields(data: RPAAction, set: (u: Partial<RPAAction>) => void) {
  switch (data.type) {
    case 'accessWebsite':
      return (
        <>
          <div className="rpa-modal-field">
            <label>* Access URL</label>
            <div className="rpa-field-row">
              <input value={data.value || ''} onChange={(e) => set({ value: e.target.value })} placeholder="https://..." style={{ flex: 1 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Timeout waiting</label>
            <div className="rpa-field-row">
              <input type="number" value={data.timeout || 10000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 10000 })} style={{ width: 120 }} />
              <span className="rpa-unit">Millisecond</span>
              <span className="rpa-hint">1 second = 1000 milliseconds</span>
            </div>
          </div>
        </>
      );

    case 'click':
      return (
        <>
          <div className="rpa-modal-field">
            <div className="rpa-tabs">
              <button className={!data.useStoredElement ? 'active' : ''} onClick={() => set({ useStoredElement: false })}>Selector</button>
              <button className={data.useStoredElement ? 'active' : ''} onClick={() => set({ useStoredElement: true })}>Stored element object</button>
            </div>
          </div>
          {!data.useStoredElement ? (
            <div className="rpa-modal-field">
              <label>Selector</label>
              <div className="rpa-radio-row">
                <label><input type="radio" checked={data.selectorType !== 'xpath' && data.selectorType !== 'text'} onChange={() => set({ selectorType: 'css' })} /> Selector</label>
                <label><input type="radio" checked={data.selectorType === 'xpath'} onChange={() => set({ selectorType: 'xpath' })} /> XPath</label>
                <label><input type="radio" checked={data.selectorType === 'text'} onChange={() => set({ selectorType: 'text' })} /> Text</label>
              </div>
              <div className="rpa-field-row">
                <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder={data.selectorType === 'xpath' ? '//div[@class="btn"]' : '.add-to-cart-button'} style={{ flex: 1 }} />
                <span className="rpa-var-link">Use Variable*</span>
              </div>
            </div>
          ) : (
            <div className="rpa-modal-field">
              <label>Variable name</label>
              <input value={data.storedElementVar || ''} onChange={(e) => set({ storedElementVar: e.target.value })} />
            </div>
          )}
          <div className="rpa-modal-field">
            <label>Element order</label>
            <div className="rpa-field-row">
              <select value={data.elementOrder || 'first'} onChange={(e) => set({ elementOrder: e.target.value as RPAAction['elementOrder'] })}>
                <option value="first">First</option>
                <option value="last">Last</option>
                <option value="random">Random</option>
                <option value="fixed">Fixed</option>
              </select>
              {(data.elementOrder === 'random' || data.elementOrder === 'fixed') && (
                <>
                  <input type="number" value={data.elementOrderMin || 1} onChange={(e) => set({ elementOrderMin: parseInt(e.target.value) || 1 })} style={{ width: 60 }} />
                  <span>-</span>
                  <input type="number" value={data.elementOrderMax || 2} onChange={(e) => set({ elementOrderMax: parseInt(e.target.value) || 2 })} style={{ width: 60 }} />
                </>
              )}
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Button act</label>
            <select value={data.buttonAct || 'left'} onChange={(e) => set({ buttonAct: e.target.value as RPAAction['buttonAct'] })}>
              <option value="left">Left click</option>
              <option value="right">Right click</option>
              <option value="double">Double click</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Click act</label>
            <select value={data.clickAct || 'click'} onChange={(e) => set({ clickAct: e.target.value as RPAAction['clickAct'] })}>
              <option value="click">Click</option>
              <option value="hold">Hold</option>
            </select>
          </div>
        </>
      );

    case 'input':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Selector</label>
            <div className="rpa-radio-row">
              <label><input type="radio" checked={data.selectorType !== 'xpath'} onChange={() => set({ selectorType: 'css' })} /> Selector</label>
              <label><input type="radio" checked={data.selectorType === 'xpath'} onChange={() => set({ selectorType: 'xpath' })} /> XPath</label>
            </div>
            <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="CSS selector or XPath..." />
          </div>
          <div className="rpa-modal-field">
            <label>Input text</label>
            <div className="rpa-field-row">
              <input value={data.value || ''} onChange={(e) => set({ value: e.target.value })} placeholder="Text to input..." style={{ flex: 1 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
        </>
      );

    case 'scroll':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Scroll distance</label>
            <div className="rpa-tabs">
              <button className={data.scrollTarget !== 'selector' ? 'active' : ''} onClick={() => set({ scrollTarget: 'page' })}>Page</button>
              <button className={data.scrollTarget === 'selector' ? 'active' : ''} onClick={() => set({ scrollTarget: 'selector' })}>Selector</button>
            </div>
          </div>
          {data.scrollTarget === 'selector' && (
            <div className="rpa-modal-field">
              <label>Selector</label>
              <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} />
            </div>
          )}
          <div className="rpa-modal-field">
            <label>Position</label>
            <div className="rpa-field-row">
              <select value={data.scrollPosition || 'bottom'} onChange={(e) => set({ scrollPosition: e.target.value as RPAAction['scrollPosition'] })}>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Scroll Type</label>
            <select value={data.scrollType || 'smooth'} onChange={(e) => set({ scrollType: e.target.value as RPAAction['scrollType'] })}>
              <option value="smooth">Smooth</option>
              <option value="instant">Instant</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Scroll Speed</label>
            <div className="rpa-field-row">
              <span>A single scroll is randomly between</span>
              <input type="number" value={data.scrollSpeedMin || 100} onChange={(e) => set({ scrollSpeedMin: parseInt(e.target.value) || 100 })} style={{ width: 70 }} />
              <span>-</span>
              <input type="number" value={data.scrollSpeedMax || 150} onChange={(e) => set({ scrollSpeedMax: parseInt(e.target.value) || 150 })} style={{ width: 70 }} />
              <span>pixels</span>
            </div>
            <div className="rpa-field-row" style={{ marginTop: 6 }}>
              <span>Duration is randomly between</span>
              <input type="number" value={data.scrollDurationMin || 200} onChange={(e) => set({ scrollDurationMin: parseInt(e.target.value) || 200 })} style={{ width: 70 }} />
              <span>-</span>
              <input type="number" value={data.scrollDurationMax || 300} onChange={(e) => set({ scrollDurationMax: parseInt(e.target.value) || 300 })} style={{ width: 70 }} />
              <span>ms</span>
            </div>
          </div>
        </>
      );

    case 'waitTime':
      return (
        <div className="rpa-modal-field">
          <label>Timeout waiting</label>
          <div className="rpa-field-row">
            <select value={data.timeoutMode || 'fixed'} onChange={(e) => set({ timeoutMode: e.target.value as 'fixed' | 'random' })}>
              <option value="fixed">Fixed</option>
              <option value="random">Random</option>
            </select>
            {data.timeoutMode === 'random' ? (
              <>
                <input type="number" value={data.timeoutMin || 5000} onChange={(e) => set({ timeoutMin: parseInt(e.target.value) || 5000 })} style={{ width: 90 }} />
                <span>-</span>
                <input type="number" value={data.timeoutMax || 30000} onChange={(e) => set({ timeoutMax: parseInt(e.target.value) || 30000 })} style={{ width: 90 }} />
              </>
            ) : (
              <input type="number" value={data.timeout || 5000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 5000 })} style={{ width: 120 }} />
            )}
            <span className="rpa-unit">Millisecond</span>
          </div>
          <span className="rpa-hint">1 second = 1000 milliseconds</span>
        </div>
      );

    case 'waitElement':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Selector</label>
            <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="CSS selector..." />
          </div>
          <div className="rpa-modal-field">
            <label>Timeout</label>
            <div className="rpa-field-row">
              <input type="number" value={data.timeout || 10000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 10000 })} style={{ width: 120 }} />
              <span className="rpa-unit">Millisecond</span>
            </div>
          </div>
        </>
      );

    case 'forLoop':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Times</label>
            <div className="rpa-field-row">
              <input type="number" value={data.times || 5} onChange={(e) => set({ times: parseInt(e.target.value) || 1 })} style={{ width: 100 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Save loop element index to</label>
            <input value={data.loopVariable || 'for_times_index'} onChange={(e) => set({ loopVariable: e.target.value })} />
          </div>
        </>
      );

    case 'executeJS':
      return (
        <div className="rpa-modal-field">
          <label>JavaScript code</label>
          <textarea
            value={data.value || ''}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="// Your JavaScript code here..."
            rows={6}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
          />
        </div>
      );

    case 'keys':
      return (
        <div className="rpa-modal-field">
          <label>Key</label>
          <select value={data.value || 'Enter'} onChange={(e) => set({ value: e.target.value })}>
            <option value="Enter">Enter</option>
            <option value="Tab">Tab</option>
            <option value="Escape">Escape</option>
            <option value="Backspace">Backspace</option>
            <option value="Delete">Delete</option>
            <option value="ArrowUp">Arrow Up</option>
            <option value="ArrowDown">Arrow Down</option>
            <option value="ArrowLeft">Arrow Left</option>
            <option value="ArrowRight">Arrow Right</option>
            <option value="Space">Space</option>
            <option value="Home">Home</option>
            <option value="End">End</option>
            <option value="PageUp">Page Up</option>
            <option value="PageDown">Page Down</option>
          </select>
        </div>
      );

    case 'keyCombination':
      return (
        <div className="rpa-modal-field">
          <label>Key combination</label>
          <input value={(data.keys || []).join('+')} onChange={(e) => set({ keys: e.target.value.split('+').map((k) => k.trim()) })} placeholder="Ctrl+C, Ctrl+V, Ctrl+A..." />
          <span className="rpa-hint">Separate keys with + (e.g. Ctrl+Shift+A)</span>
        </div>
      );

    case 'switchTab':
      return (
        <div className="rpa-modal-field">
          <label>Tab index (0 = first tab)</label>
          <input type="number" value={data.tabIndex || 0} onChange={(e) => set({ tabIndex: parseInt(e.target.value) || 0 })} style={{ width: 100 }} />
        </div>
      );

    case 'hover': case 'focus': case 'dropdown':
      return (
        <div className="rpa-modal-field">
          <label>Selector</label>
          <div className="rpa-radio-row">
            <label><input type="radio" checked={data.selectorType !== 'xpath'} onChange={() => set({ selectorType: 'css' })} /> Selector</label>
            <label><input type="radio" checked={data.selectorType === 'xpath'} onChange={() => set({ selectorType: 'xpath' })} /> XPath</label>
          </div>
          <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="CSS selector or XPath..." />
          {data.type === 'dropdown' && (
            <div style={{ marginTop: 8 }}>
              <label>Option value</label>
              <input value={data.optionValue || ''} onChange={(e) => set({ optionValue: e.target.value })} placeholder="Value to select..." />
            </div>
          )}
        </div>
      );

    case 'getElement':
      return (
        <div className="rpa-modal-field">
          <label>Selector</label>
          <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="CSS selector..." />
        </div>
      );

    case 'ifCondition':
      return (
        <div className="rpa-modal-field">
          <label>Condition (JavaScript expression)</label>
          <input value={data.condition || ''} onChange={(e) => set({ condition: e.target.value })} placeholder="document.querySelector('.element') !== null" />
        </div>
      );

    default:
      return <div className="rpa-modal-field"><span className="rpa-hint">No additional configuration needed</span></div>;
  }
}
