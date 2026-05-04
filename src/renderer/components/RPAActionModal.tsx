import { useState, useEffect, useCallback } from 'react';
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
          <DescriptionField value={data.description} onChange={(v) => set({ description: v })} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={() => onSave(data)}>OK</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function DescriptionField({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <div className="rpa-modal-field">
      <label>Description</label>
      <div style={{ position: 'relative' }}>
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Optional" maxLength={100} />
        <span className="rpa-char-count">{(value || '').length} / 100</span>
      </div>
    </div>
  );
}

/** Reusable selector field with Selector/Stored element tabs, CSS/XPath/Text radio */
function SelectorField({ data, set }: { data: RPAAction; set: (u: Partial<RPAAction>) => void }) {
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
            <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="Please enter the element, such as #email input" style={{ flex: 1 }} />
            <span className="rpa-var-link">Use Variable*</span>
          </div>
        </div>
      ) : (
        <div className="rpa-modal-field">
          <label>Variable name</label>
          <input value={data.storedElementVar || ''} onChange={(e) => set({ storedElementVar: e.target.value })} />
        </div>
      )}
    </>
  );
}

/** Reusable element order field */
function ElementOrderField({ data, set }: { data: RPAAction; set: (u: Partial<RPAAction>) => void }) {
  return (
    <div className="rpa-modal-field">
      <label>Element order</label>
      <div className="rpa-field-row">
        <select value={data.elementOrder || 'fixed'} onChange={(e) => set({ elementOrder: e.target.value as RPAAction['elementOrder'] })} style={{ width: 120 }}>
          <option value="first">First</option>
          <option value="last">Last</option>
          <option value="random">Random</option>
          <option value="fixed">Fixed</option>
        </select>
        {data.elementOrder === 'random' ? (
          <>
            <input type="number" value={data.elementOrderMin || 1} onChange={(e) => set({ elementOrderMin: parseInt(e.target.value) || 1 })} style={{ width: 60 }} />
            <span>-</span>
            <input type="number" value={data.elementOrderMax || 2} onChange={(e) => set({ elementOrderMax: parseInt(e.target.value) || 2 })} style={{ width: 60 }} />
          </>
        ) : data.elementOrder === 'fixed' ? (
          <>
            <input type="number" value={data.elementOrderMin || 1} onChange={(e) => set({ elementOrderMin: parseInt(e.target.value) || 1 })} style={{ width: 80 }} />
            <span className="rpa-var-link">Use Variable*</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function renderFields(data: RPAAction, set: (u: Partial<RPAAction>) => void) {
  switch (data.type) {
    // ─── Access Website ───
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

    // ─── Click ───
    case 'click':
      return (
        <>
          <SelectorField data={data} set={set} />
          <ElementOrderField data={data} set={set} />
          <div className="rpa-modal-field">
            <label>Button act</label>
            <select value={data.buttonAct || 'left'} onChange={(e) => set({ buttonAct: e.target.value as RPAAction['buttonAct'] })} style={{ width: 140 }}>
              <option value="left">Left click</option>
              <option value="right">Right click</option>
              <option value="double">Double click</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Click act</label>
            <select value={data.clickAct || 'click'} onChange={(e) => set({ clickAct: e.target.value as RPAAction['clickAct'] })} style={{ width: 140 }}>
              <option value="click">Click</option>
              <option value="hold">Hold</option>
            </select>
          </div>
        </>
      );

    // ─── Input ───
    case 'input':
      return (
        <>
          <div className="rpa-info-box">ℹ️ Enter in the corresponding element. <a href="#">Learn more</a></div>
          <SelectorField data={data} set={set} />
          <ElementOrderField data={data} set={set} />
          <div className="rpa-modal-field">
            <div className="rpa-tabs" style={{ marginBottom: 8 }}>
              <button className={data.inputMode !== 'atRandom' && data.inputMode !== 'randomNumber' ? 'active' : ''} onClick={() => set({ inputMode: 'inOrder' })}>In order</button>
              <button className={data.inputMode === 'atRandom' ? 'active' : ''} onClick={() => set({ inputMode: 'atRandom' })}>At random</button>
              <button className={data.inputMode === 'randomNumber' ? 'active' : ''} onClick={() => set({ inputMode: 'randomNumber' })}>Random number</button>
            </div>
            <label className="rpa-checkbox">
              <input type="checkbox" checked={data.clearBeforeInput || false} onChange={(e) => set({ clearBeforeInput: e.target.checked })} />
              Clear the content and enter
            </label>
          </div>
          <div className="rpa-modal-field">
            <label>* Content</label>
            <div className="rpa-field-row">
              <textarea
                value={data.value || ''}
                onChange={(e) => set({ value: e.target.value })}
                placeholder="Please enter a single content on one line;&#10;Please enter multiple content in a new line, and one of the content will be selected."
                rows={5}
                style={{ flex: 1 }}
              />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
        </>
      );

    // ─── Hover / Focus ───
    case 'hover': case 'focus':
      return (
        <>
          <SelectorField data={data} set={set} />
          <ElementOrderField data={data} set={set} />
        </>
      );

    // ─── Drop-down ───
    case 'dropdown':
      return (
        <>
          <SelectorField data={data} set={set} />
          <ElementOrderField data={data} set={set} />
          <div className="rpa-modal-field">
            <label>* Selected value</label>
            <div className="rpa-field-row">
              <input value={data.optionValue || ''} onChange={(e) => set({ optionValue: e.target.value })} placeholder="Please fill in the selected value" style={{ flex: 1 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
        </>
      );

    // ─── Scroll ───
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
              <select value="position" style={{ width: 100 }}><option>Position</option></select>
              <select value={data.scrollPosition || 'bottom'} onChange={(e) => set({ scrollPosition: e.target.value as RPAAction['scrollPosition'] })} style={{ width: 100 }}>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Scroll Type</label>
            <select value={data.scrollType || 'smooth'} onChange={(e) => set({ scrollType: e.target.value as RPAAction['scrollType'] })} style={{ width: 120 }}>
              <option value="smooth">Smooth</option>
              <option value="instant">Instant</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Scroll Speed</label>
            <div className="rpa-field-row">
              <span style={{ fontSize: 12 }}>A single scroll is randomly between</span>
              <input type="number" value={data.scrollSpeedMin || 100} onChange={(e) => set({ scrollSpeedMin: parseInt(e.target.value) || 100 })} style={{ width: 70 }} />
              <span>-</span>
              <input type="number" value={data.scrollSpeedMax || 150} onChange={(e) => set({ scrollSpeedMax: parseInt(e.target.value) || 150 })} style={{ width: 70 }} />
              <span className="rpa-unit">pixels</span>
            </div>
            <div className="rpa-field-row" style={{ marginTop: 6 }}>
              <span style={{ fontSize: 12 }}>Duration is randomly between</span>
              <input type="number" value={data.scrollDurationMin || 200} onChange={(e) => set({ scrollDurationMin: parseInt(e.target.value) || 200 })} style={{ width: 70 }} />
              <span>-</span>
              <input type="number" value={data.scrollDurationMax || 300} onChange={(e) => set({ scrollDurationMax: parseInt(e.target.value) || 300 })} style={{ width: 70 }} />
              <span className="rpa-unit">ms</span>
            </div>
          </div>
        </>
      );

    // ─── Screenshot ───
    case 'screenshot':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Screenshot name</label>
            <div className="rpa-field-row">
              <input value={data.screenshotName || ''} onChange={(e) => set({ screenshotName: e.target.value })} placeholder="Default: Task id + user id + timestamp" maxLength={100} style={{ flex: 1 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Select folder</label>
            <div className="rpa-tabs">
              <button className={data.screenshotFolder !== 'local' ? 'active' : ''} onClick={() => set({ screenshotFolder: 'default' })}>Default folder</button>
              <button className={data.screenshotFolder === 'local' ? 'active' : ''} onClick={() => set({ screenshotFolder: 'local' })}>Local folder</button>
            </div>
            {data.screenshotFolder === 'local' && (
              <input value={data.screenshotLocalPath || ''} onChange={(e) => set({ screenshotLocalPath: e.target.value })} placeholder="Enter local folder path..." style={{ marginTop: 8 }} />
            )}
          </div>
          <div className="rpa-modal-field">
            <label>Full-page</label>
            <label className="rpa-toggle">
              <input type="checkbox" checked={data.screenshotFullPage !== false} onChange={(e) => set({ screenshotFullPage: e.target.checked })} />
              <span className="rpa-toggle-slider"></span>
            </label>
          </div>
          <div className="rpa-modal-field">
            <label>Format</label>
            <select value={data.screenshotFormat || 'png'} onChange={(e) => set({ screenshotFormat: e.target.value as 'png' | 'jpeg' })} style={{ width: 100 }}>
              <option value="png">png</option>
              <option value="jpeg">jpeg</option>
            </select>
          </div>
        </>
      );

    // ─── Wait Time ───
    case 'waitTime':
      return (
        <div className="rpa-modal-field">
          <label>Timeout waiting</label>
          <div className="rpa-field-row">
            <select value={data.timeoutMode || 'fixed'} onChange={(e) => set({ timeoutMode: e.target.value as 'fixed' | 'random' })} style={{ width: 110 }}>
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

    // ─── Wait Element (Element Appears) ───
    case 'waitElement':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Selector</label>
            <div className="rpa-radio-row">
              <label><input type="radio" checked={data.selectorType !== 'xpath' && data.selectorType !== 'text'} onChange={() => set({ selectorType: 'css' })} /> Selector</label>
              <label><input type="radio" checked={data.selectorType === 'xpath'} onChange={() => set({ selectorType: 'xpath' })} /> XPath</label>
              <label><input type="radio" checked={data.selectorType === 'text'} onChange={() => set({ selectorType: 'text' })} /> Text</label>
            </div>
            <div className="rpa-field-row">
              <input value={data.selector || ''} onChange={(e) => set({ selector: e.target.value })} placeholder="Please enter the element, such as #email input" style={{ flex: 1 }} />
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
          <ElementOrderField data={data} set={set} />
          <div className="rpa-modal-field">
            <label>Visible</label>
            <label className="rpa-toggle">
              <input type="checkbox" checked={data.visible !== false} onChange={(e) => set({ visible: e.target.checked })} />
              <span className="rpa-toggle-slider"></span>
            </label>
          </div>
          <div className="rpa-modal-field">
            <label>Timeout waiting</label>
            <div className="rpa-field-row">
              <input type="number" value={data.timeout || 30000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 30000 })} style={{ width: 120 }} />
              <span className="rpa-unit">Millisecond</span>
              <span className="rpa-hint">1 second = 1000 milliseconds</span>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Save to</label>
            <input value={data.saveTo || ''} onChange={(e) => set({ saveTo: e.target.value })} placeholder="Please fill in the variable to save the result" />
          </div>
        </>
      );

    // ─── Wait Request (Request to Finish) ───
    case 'waitRequest':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Response URL</label>
            <input value={data.responseUrl || ''} onChange={(e) => set({ responseUrl: e.target.value })} placeholder="Please fill in the content consisted in the request URL" />
          </div>
          <div className="rpa-modal-field">
            <label>Timeout waiting</label>
            <div className="rpa-field-row">
              <input type="number" value={data.timeout || 30000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 30000 })} style={{ width: 120 }} />
              <span className="rpa-unit">Millisecond</span>
              <span className="rpa-hint">1 second = 1000 milliseconds</span>
            </div>
          </div>
        </>
      );

    // ─── For Loop ───
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

    // ─── Execute JavaScript ───
    case 'executeJS':
      return (
        <>
          <div className="rpa-modal-field">
            <label>JavaScript</label>
            <div className="rpa-js-wrapper">
              <div className="rpa-js-header">(async function(){'{'}</div>
              <textarea
                value={data.value || ''}
                onChange={(e) => set({ value: e.target.value })}
                placeholder="write your Javascript code here"
                rows={6}
                className="rpa-js-textarea"
              />
              <div className="rpa-js-footer">{'}'})()</div>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Inject Variables</label>
            <select value={data.injectVariables || ''} onChange={(e) => set({ injectVariables: e.target.value })}>
              <option value="">Please select variable</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Return Value Save to</label>
            <input value={data.returnValueSaveTo || ''} onChange={(e) => set({ returnValueSaveTo: e.target.value })} placeholder="Execute the Javascript script function Return to save the value to..." />
          </div>
        </>
      );

    // ─── Keys ───
    case 'keys':
      return (
        <div className="rpa-modal-field">
          <label>Keys</label>
          <select value={data.value || 'Enter'} onChange={(e) => set({ value: e.target.value })} style={{ width: 160 }}>
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

    // ─── Key Combination ───
    case 'keyCombination':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Key combination</label>
            <KeyCombinationRecorder value={data.recordedKeys || ''} onChange={(v) => set({ recordedKeys: v, keys: v.split('+').map((k) => k.trim()) })} />
          </div>
          <div className="rpa-info-box" style={{ background: '#f5f5f5', marginTop: 8 }}>
            <strong>Note:</strong><br />
            1. In the Windows system, only Ctrl+A, Ctrl+C, Ctrl+V, and Ctrl+R are supported.<br />
            2. In macOS system, only ⌘A, ⌘C, ⌘V, ⌘R are supported.
          </div>
        </>
      );

    // ─── Go Back ───
    case 'goBack':
      return (
        <div className="rpa-modal-field">
          <label>Timeout waiting</label>
          <div className="rpa-field-row">
            <input type="number" value={data.timeout || 30000} onChange={(e) => set({ timeout: parseInt(e.target.value) || 30000 })} style={{ width: 120 }} />
            <span className="rpa-unit">Millisecond</span>
            <span className="rpa-hint">1 second = 1000 milliseconds</span>
          </div>
        </div>
      );

    // ─── Switch Tab ───
    case 'switchTab':
      return (
        <div className="rpa-modal-field">
          <label>Tab index (0 = first tab)</label>
          <input type="number" value={data.tabIndex || 0} onChange={(e) => set({ tabIndex: parseInt(e.target.value) || 0 })} style={{ width: 100 }} />
        </div>
      );

    // ─── Get Element ───
    case 'getElement':
      return (
        <>
          <div className="rpa-info-box">ℹ️ To obtain web page elements and save them as variables. <a href="#">Learn more</a></div>
          <SelectorField data={data} set={set} />
          <ElementOrderField data={data} set={set} />
          <div className="rpa-modal-field">
            <label>Extraction type</label>
            <select value={data.extractionType || 'fullUrl'} onChange={(e) => set({ extractionType: e.target.value as RPAAction['extractionType'] })} style={{ width: 140 }}>
              <option value="fullUrl">Text</option>
              <option value="domain">HTML</option>
              <option value="path">Attribute</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Save to</label>
            <input value={data.saveTo || ''} onChange={(e) => set({ saveTo: e.target.value })} placeholder="Saved variable name" />
          </div>
        </>
      );

    // ─── If Condition ───
    case 'ifCondition':
      return (
        <div className="rpa-modal-field">
          <label>Condition (JavaScript expression)</label>
          <input value={data.condition || ''} onChange={(e) => set({ condition: e.target.value })} placeholder="document.querySelector('.element') !== null" />
        </div>
      );

    // ─── Get URL ───
    case 'getURL':
      return (
        <>
          <div className="rpa-modal-field">
            <label>Extraction type</label>
            <select value={data.extractionType || 'fullUrl'} onChange={(e) => set({ extractionType: e.target.value as RPAAction['extractionType'] })} style={{ width: 140 }}>
              <option value="fullUrl">Full Url</option>
              <option value="domain">Domain</option>
              <option value="path">Path</option>
              <option value="query">Query</option>
            </select>
          </div>
          <div className="rpa-modal-field">
            <label>Save to</label>
            <input value={data.saveTo || ''} onChange={(e) => set({ saveTo: e.target.value })} placeholder="Saved variable name" />
          </div>
        </>
      );

    // ─── Get Clipboard ───
    case 'getClipboard':
      return (
        <div className="rpa-modal-field">
          <label>Save to</label>
          <input value={data.saveTo || ''} onChange={(e) => set({ saveTo: e.target.value })} placeholder="Saved variable name" />
        </div>
      );

    // ─── Get Focused Element ───
    case 'getFocusedElement':
      return (
        <>
          <div className="rpa-info-box">Get the currently focused element on the page</div>
          <div className="rpa-modal-field">
            <label>Save to</label>
            <input value={data.saveTo || ''} onChange={(e) => set({ saveTo: e.target.value })} placeholder="Saved variable name" />
          </div>
        </>
      );

    // ─── Save to Txt ───
    case 'saveTxt':
      return (
        <>
          <div className="rpa-modal-field">
            <label>File Name</label>
            <div className="rpa-field-row">
              <input value={data.fileName || ''} onChange={(e) => set({ fileName: e.target.value })} placeholder="Please enter the file name" style={{ flex: 1 }} />
              <span className="rpa-unit">-${'{'} Task ID {'}'}.txt</span>
              <span className="rpa-var-link">Use Variable*</span>
            </div>
          </div>
          <div className="rpa-modal-field">
            <label>Select Column</label>
            <select value={data.selectColumn || ''} onChange={(e) => set({ selectColumn: e.target.value })}>
              <option value="">Please select variable</option>
            </select>
          </div>
        </>
      );

    // ─── Simple actions (no extra config) ───
    default:
      return <div className="rpa-modal-field"><span className="rpa-hint">No additional configuration needed</span></div>;
  }
}

/** Key combination recorder component */
function KeyCombinationRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    if (parts.length > 0) {
      onChange(parts.join('+'));
      setRecording(false);
    }
  }, [recording, onChange]);

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [recording, handleKeyDown]);

  return (
    <div className="rpa-field-row">
      <div
        className={`rpa-key-recorder ${recording ? 'recording' : ''}`}
        onClick={() => setRecording(true)}
      >
        {value || 'Record combination key'}
      </div>
      {value && <button className="rpa-key-clear" onClick={() => onChange('')}>✕</button>}
    </div>
  );
}
