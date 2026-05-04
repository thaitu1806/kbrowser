/**
 * RPA Format Converter
 * Converts between AdsPower RPA JSON format and Ken's Browser IM RPAAction format.
 * Supports Import (AdsPower → KenBrowser) and Export (KenBrowser → AdsPower).
 */

import type { RPAAction, RPAActionType } from '@shared/types';

// ─── AdsPower format types ───
interface AdsPowerAction {
  type: string;
  config: Record<string, unknown>;
}

// ─── Type mapping: AdsPower → KenBrowser ───
const ADS_TO_KEN_TYPE: Record<string, RPAActionType> = {
  newPage: 'newTab',
  closePage: 'closeTab',
  closeOtherPage: 'closeOtherTabs',
  switchPage: 'switchTab',
  gotoUrl: 'accessWebsite',
  refreshPage: 'refreshWebpage',
  goBack: 'goBack',
  screenshot: 'screenshot',
  hover: 'hover',
  dropdown: 'dropdown',
  focus: 'focus',
  click: 'click',
  input: 'input',
  scrollPage: 'scroll',
  uploadFile: 'inputFile',
  executeJs: 'executeJS',
  keyboardInput: 'keys',
  keyCombination: 'keyCombination',
  waitTime: 'waitTime',
  waitElement: 'waitElement',
  waitRequest: 'waitRequest',
  getUrl: 'getURL',
  getClipboard: 'getClipboard',
  getElement: 'getElement',
  getFocusedElement: 'getFocusedElement',
  saveTxt: 'saveTxt',
  forTimes: 'forLoop',
  ifCondition: 'ifCondition',
};

// ─── Type mapping: KenBrowser → AdsPower ───
const KEN_TO_ADS_TYPE: Record<RPAActionType, string> = {} as Record<RPAActionType, string>;
for (const [adsType, kenType] of Object.entries(ADS_TO_KEN_TYPE)) {
  KEN_TO_ADS_TYPE[kenType] = adsType;
}

/**
 * Import: Convert AdsPower JSON array to KenBrowser RPAAction array
 */
export function importFromAdsPower(adsActions: AdsPowerAction[]): RPAAction[] {
  return adsActions.map((adsAction) => convertAdsToKen(adsAction));
}

function convertAdsToKen(ads: AdsPowerAction): RPAAction {
  const type = ADS_TO_KEN_TYPE[ads.type] || 'accessWebsite';
  const c = ads.config;
  const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const base: RPAAction = { id, type, description: (c.remark as string) || '' };

  switch (ads.type) {
    case 'gotoUrl':
      return { ...base, value: c.url as string, timeout: (c.timeout as number) || 10000 };

    case 'click':
      return {
        ...base,
        selector: c.selector as string,
        selectorType: c.selectorRadio === 'XPath' ? 'xpath' : 'css',
        elementOrder: c.serialType === 'randomInterval' ? 'random' : 'fixed',
        elementOrderMin: (c.serialMin as number) || 1,
        elementOrderMax: (c.serialMax as number) || 1,
        buttonAct: (c.button as 'left' | 'right' | 'double') || 'left',
        clickAct: (c.type as 'click' | 'hold') || 'click',
      };

    case 'input':
      return {
        ...base,
        selector: c.selector as string,
        selectorType: c.selectorRadio === 'XPath' ? 'xpath' : 'css',
        value: c.content as string || c.value as string || '',
      };

    case 'scrollPage':
      return {
        ...base,
        scrollTarget: c.rangeType === 'element' ? 'selector' : 'page',
        selector: c.selector as string,
        scrollPosition: (c.position as 'top' | 'bottom') || 'bottom',
        scrollType: (c.type as 'smooth' | 'instant') || 'smooth',
        scrollSpeedMin: Array.isArray(c.randomWheelDistance) ? c.randomWheelDistance[0] : 100,
        scrollSpeedMax: Array.isArray(c.randomWheelDistance) ? c.randomWheelDistance[1] : 150,
        scrollDurationMin: Array.isArray(c.randomWheelSleepTime) ? c.randomWheelSleepTime[0] : 200,
        scrollDurationMax: Array.isArray(c.randomWheelSleepTime) ? c.randomWheelSleepTime[1] : 300,
      };

    case 'waitTime':
      return {
        ...base,
        timeoutMode: c.timeoutType === 'randomInterval' ? 'random' : 'fixed',
        timeout: (c.timeout as number) || 5000,
        timeoutMin: (c.timeoutMin as number) || 5000,
        timeoutMax: (c.timeoutMax as number) || 30000,
      };

    case 'waitElement':
      return {
        ...base,
        selector: c.selector as string,
        timeout: (c.timeout as number) || 30000,
      };

    case 'forTimes':
      return {
        ...base,
        times: (c.times as number) || 5,
        loopVariable: (c.variableIndex as string) || 'for_times_index',
        children: Array.isArray(c.children)
          ? (c.children as AdsPowerAction[]).map((child) => convertAdsToKen(child))
          : [],
      };

    case 'hover': case 'focus': case 'dropdown':
      return {
        ...base,
        selector: c.selector as string,
        selectorType: c.selectorRadio === 'XPath' ? 'xpath' : 'css',
      };

    case 'screenshot':
      return { ...base, screenshotName: c.name as string };

    case 'executeJs':
      return { ...base, value: c.code as string };

    case 'keyboardInput':
      return { ...base, value: c.key as string };

    case 'keyCombination':
      return { ...base, keys: c.keys as string[] };

    default:
      return base;
  }
}

/**
 * Export: Convert KenBrowser RPAAction array to AdsPower JSON format
 */
export function exportToAdsPower(actions: RPAAction[]): AdsPowerAction[] {
  return actions.map((action) => convertKenToAds(action));
}

function convertKenToAds(action: RPAAction): AdsPowerAction {
  const adsType = KEN_TO_ADS_TYPE[action.type] || action.type;

  switch (action.type) {
    case 'accessWebsite':
      return { type: adsType, config: { url: action.value || '', timeout: action.timeout || 10000, remark: action.description || '' } };

    case 'click':
      return {
        type: adsType,
        config: {
          selectorRadio: action.selectorType === 'xpath' ? 'XPath' : 'CSS',
          selector: action.selector || '',
          selectorType: 'selector',
          element: '',
          serialType: action.elementOrder === 'random' ? 'randomInterval' : 'fixed',
          serial: action.elementOrderMin || 1,
          serialMin: action.elementOrderMin || 1,
          serialMax: action.elementOrderMax || 1,
          button: action.buttonAct || 'left',
          type: action.clickAct || 'click',
          remark: action.description || '',
        },
      };

    case 'input':
      return {
        type: adsType,
        config: {
          selectorRadio: action.selectorType === 'xpath' ? 'XPath' : 'CSS',
          selector: action.selector || '',
          content: action.value || '',
          remark: action.description || '',
        },
      };

    case 'scroll':
      return {
        type: adsType,
        config: {
          rangeType: action.scrollTarget === 'selector' ? 'element' : 'window',
          selectorRadio: 'CSS',
          selector: action.selector || '',
          serial: 1,
          distance: 0,
          type: action.scrollType || 'smooth',
          scrollType: 'position',
          position: action.scrollPosition || 'bottom',
          remark: action.description || '',
          randomWheelDistance: [action.scrollSpeedMin || 100, action.scrollSpeedMax || 150],
          randomWheelSleepTime: [action.scrollDurationMin || 200, action.scrollDurationMax || 300],
        },
      };

    case 'waitTime':
      return {
        type: adsType,
        config: {
          timeoutType: action.timeoutMode === 'random' ? 'randomInterval' : 'fixed',
          timeout: action.timeout || 5000,
          timeoutMin: action.timeoutMin || 5000,
          timeoutMax: action.timeoutMax || 30000,
          remark: action.description || '',
        },
      };

    case 'forLoop':
      return {
        type: adsType,
        config: {
          times: action.times || 5,
          variableIndex: action.loopVariable || 'for_times_index',
          remark: action.description || '',
          hiddenChildren: false,
          children: (action.children || []).map((child) => convertKenToAds(child)),
        },
      };

    case 'newTab':
      return { type: adsType, config: {} };

    case 'screenshot':
      return { type: adsType, config: { name: action.screenshotName || '', remark: action.description || '' } };

    default:
      return { type: adsType, config: { remark: action.description || '' } };
  }
}
