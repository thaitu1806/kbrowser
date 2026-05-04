import { useState, useRef, useEffect } from 'react';

/** System variables available in RPA scripts */
const SYSTEM_VARIABLES = [
  { name: 'task_id', type: 'String', desc: 'Task ID' },
  { name: 'task_name', type: 'String', desc: 'Process name' },
  { name: 'serial_number', type: 'String', desc: 'Profile No.' },
  { name: 'browser_name', type: 'String', desc: 'Name of profile' },
  { name: 'acc_id', type: 'String', desc: 'Profile ID' },
  { name: 'comment', type: 'String', desc: 'Profile Remark' },
  { name: 'user_name', type: 'String', desc: 'Platform Account' },
  { name: 'password', type: 'String', desc: 'Password' },
];

interface Props {
  /** Current input value */
  value: string;
  /** Called with new value after variable is inserted */
  onChange: (value: string) => void;
  /** Reference to the input element to insert at cursor position */
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
}

export default function UseVariableDropdown({ value, onChange, inputRef }: Props) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const insertVariable = (varName: string) => {
    const varStr = `\${${varName}}`;
    if (inputRef?.current) {
      const el = inputRef.current;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const newValue = value.slice(0, start) + varStr + value.slice(end);
      onChange(newValue);
      // Restore cursor position after variable
      setTimeout(() => {
        el.focus();
        const newPos = start + varStr.length;
        el.setSelectionRange(newPos, newPos);
      }, 0);
    } else {
      onChange(value + varStr);
    }
    setOpen(false);
  };

  return (
    <div className="use-var-wrapper" ref={dropdownRef}>
      <span className="rpa-var-link" onClick={() => setOpen(!open)}>Use Variable*</span>
      {open && (
        <div className="use-var-dropdown">
          {SYSTEM_VARIABLES.map((v) => (
            <button
              key={v.name}
              className="use-var-item"
              onClick={() => insertVariable(v.name)}
            >
              <span className="use-var-name">{v.name}</span>
              <span className="use-var-desc">&lt;{v.desc}&gt;&lt;{v.type}&gt;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
