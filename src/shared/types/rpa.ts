/**
 * RPA Engine types.
 * Types for no-code automation scripts, actions, and templates.
 */

/** All supported RPA action types grouped by category */
export type RPAActionType =
  // Web Actions
  | 'newTab' | 'closeTab' | 'closeOtherTabs' | 'switchTab' | 'accessWebsite'
  | 'refreshWebpage' | 'goBack' | 'screenshot' | 'hover'
  // Element Actions
  | 'dropdown' | 'focus' | 'click' | 'input' | 'scroll' | 'inputFile' | 'executeJS'
  // Keyboard Actions
  | 'keys' | 'keyCombination'
  // Waits
  | 'waitTime' | 'waitElement' | 'waitRequest'
  // Get Data
  | 'getURL' | 'getClipboard' | 'getElement' | 'getFocusedElement' | 'saveTxt'
  // Flow Control
  | 'forLoop' | 'ifCondition';

/** Category grouping for the operations panel */
export interface ActionCategory {
  name: string;
  icon: string;
  actions: { type: RPAActionType; label: string }[];
}

/** A single action block within an RPA script. */
export interface RPAAction {
  id?: string;
  type: RPAActionType;
  description?: string;
  // Selector
  selector?: string;
  selectorType?: 'css' | 'xpath' | 'text';
  useStoredElement?: boolean;
  storedElementVar?: string;
  // Values
  value?: string;
  useVariable?: boolean;
  variableName?: string;
  // Timeout
  timeout?: number;
  timeoutMode?: 'fixed' | 'random';
  timeoutMin?: number;
  timeoutMax?: number;
  // Click options
  buttonAct?: 'left' | 'right' | 'double';
  clickAct?: 'click' | 'hold';
  elementOrder?: 'first' | 'last' | 'random' | 'fixed';
  elementOrderMin?: number;
  elementOrderMax?: number;
  // Scroll options
  scrollTarget?: 'page' | 'selector';
  scrollPosition?: 'top' | 'bottom' | 'custom';
  scrollType?: 'smooth' | 'instant';
  scrollSpeedMin?: number;
  scrollSpeedMax?: number;
  scrollDurationMin?: number;
  scrollDurationMax?: number;
  direction?: 'up' | 'down';
  distance?: number;
  // Loop
  times?: number;
  loopVariable?: string;
  children?: RPAAction[];
  // Condition
  condition?: string;
  // Keys
  keys?: string[];
  // Tab
  tabIndex?: number;
  // Dropdown
  optionValue?: string;
  // After task
  afterAction?: 'clearTab' | 'quitBrowser' | 'none';
}

/** An RPA automation script definition. */
export interface RPAScript {
  id?: string;
  name: string;
  group?: string;
  actions: RPAAction[];
  errorHandling: 'stop' | 'skip' | 'retry';
  maxRetries?: number;
  afterTaskAction?: 'clearTab' | 'quitBrowser' | 'none';
}

/** Result of executing an RPA script. */
export interface RPAExecutionResult {
  success: boolean;
  actionsCompleted: number;
  totalActions: number;
  errors: RPAError[];
}

/** Error details for a failed RPA action. */
export interface RPAError {
  actionIndex: number;
  action: RPAAction;
  message: string;
  timestamp: string;
}

/** A pre-built automation template for a specific platform. */
export interface RPATemplate {
  id: string;
  name: string;
  platform: 'facebook' | 'amazon' | 'tiktok';
  description: string;
}

/** All action categories for the operations panel */
export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    name: 'Web Actions',
    icon: '🌐',
    actions: [
      { type: 'newTab', label: 'New Tab' },
      { type: 'closeTab', label: 'Close Tab' },
      { type: 'closeOtherTabs', label: 'Close Other Tabs' },
      { type: 'switchTab', label: 'Switch Tabs' },
      { type: 'accessWebsite', label: 'Access Website' },
      { type: 'refreshWebpage', label: 'Refresh Webpage' },
      { type: 'goBack', label: 'Go Back' },
      { type: 'screenshot', label: 'Screenshot' },
      { type: 'hover', label: 'Hover' },
    ],
  },
  {
    name: 'Element Actions',
    icon: '🖱️',
    actions: [
      { type: 'dropdown', label: 'Drop-down' },
      { type: 'focus', label: 'Focus' },
      { type: 'click', label: 'Click' },
      { type: 'input', label: 'Input' },
      { type: 'scroll', label: 'Scroll' },
      { type: 'inputFile', label: 'Input File' },
      { type: 'executeJS', label: 'Execute JavaScript' },
    ],
  },
  {
    name: 'Keyboard Actions',
    icon: '⌨️',
    actions: [
      { type: 'keys', label: 'Keys' },
      { type: 'keyCombination', label: 'Key Combination' },
    ],
  },
  {
    name: 'Waits',
    icon: '⏳',
    actions: [
      { type: 'waitTime', label: 'Time' },
      { type: 'waitElement', label: 'Element Appears' },
      { type: 'waitRequest', label: 'Request to Finish' },
    ],
  },
  {
    name: 'Get Data',
    icon: '📋',
    actions: [
      { type: 'getURL', label: 'URL' },
      { type: 'getClipboard', label: 'Clipboard Content' },
      { type: 'getElement', label: 'Element' },
      { type: 'getFocusedElement', label: 'Focused Element' },
      { type: 'saveTxt', label: 'Save to Txt' },
    ],
  },
  {
    name: 'Flow Control',
    icon: '🔄',
    actions: [
      { type: 'forLoop', label: 'For Loop Times' },
      { type: 'ifCondition', label: 'If Condition' },
    ],
  },
];
