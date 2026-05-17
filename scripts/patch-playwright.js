#!/usr/bin/env node
/**
 * Patch Playwright 1.60's coreBundle.js to mitigate Runtime.Enable CDP detection.
 *
 * Problem: Playwright calls Runtime.enable on every frame, causing the browser
 * to emit Runtime.consoleAPICalled events. Anti-bot systems detect this.
 *
 * Solution: Replace all .send("Runtime.enable"...) calls with versions that
 * immediately call Runtime.disable afterwards. This allows Playwright to
 * capture execution context IDs (which happens synchronously during enable)
 * while preventing the ongoing consoleAPICalled leak.
 *
 * Usage:
 *   node scripts/patch-playwright.js          # Apply patch
 *   node scripts/patch-playwright.js --check  # Check if patched
 *   node scripts/patch-playwright.js --revert # Revert to original
 */

const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, '..', 'node_modules', 'playwright-core', 'lib', 'coreBundle.js');
const BACKUP_PATH = BUNDLE_PATH + '.bak';
const PATCH_MARKER = '/*RP*/';

function main() {
  const args = process.argv.slice(2);

  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error('❌ Not found:', BUNDLE_PATH);
    process.exit(1);
  }

  if (args.includes('--check')) {
    const code = fs.readFileSync(BUNDLE_PATH, 'utf-8');
    if (code.includes(PATCH_MARKER)) {
      console.log('✅ Patched');
    } else {
      console.log('❌ Not patched');
    }
    return;
  }

  if (args.includes('--revert')) {
    if (fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(BACKUP_PATH, BUNDLE_PATH);
      console.log('✅ Reverted to original');
    } else {
      console.log('⚠️  No backup found');
    }
    return;
  }

  // Apply patch
  let code = fs.readFileSync(BUNDLE_PATH, 'utf-8');

  if (code.includes(PATCH_MARKER)) {
    console.log('✅ Already patched');
    return;
  }

  // Backup
  fs.copyFileSync(BUNDLE_PATH, BACKUP_PATH);
  console.log('📦 Backup saved to coreBundle.js.bak');

  let count = 0;

  // Pattern 1: .send("Runtime.enable", {})
  // Replace with: .send("Runtime.enable", {}).then(function(){this.send("Runtime.disable",{}).catch(function(){})}.bind(this))
  // But 'this' is not reliable. Instead, we'll use a different approach:
  // Wrap in a helper that captures the session reference.

  // Simpler approach: Replace the string literal "Runtime.enable" with a marker,
  // then add a post-processing step. But that breaks other references.

  // SAFEST approach: Replace specific patterns with inline disable calls.

  // Pattern: session2.send("Runtime.enable", {}).catch((e) => {
  code = code.replace(
    /(\w+)\.send\("Runtime\.enable",\s*\{\}\)\.catch\(/g,
    (match, session) => {
      count++;
      return `${PATCH_MARKER}${session}.send("Runtime.enable", {}).then(function(){${session}.send("Runtime.disable",{}).catch(function(){})}).catch(`;
    }
  );

  // Pattern: session2.send("Runtime.enable", {})  (without .catch, in arrays/promises)
  code = code.replace(
    /(\w+)\.send\("Runtime\.enable",\s*\{\}\)(?!\.then|\.catch)/g,
    (match, session) => {
      count++;
      return `${PATCH_MARKER}${session}.send("Runtime.enable", {}).then(function(){${session}.send("Runtime.disable",{}).catch(function(){})})`;
    }
  );

  // Pattern: session2.send("Runtime.enable")  (no params)
  code = code.replace(
    /(\w+)\.send\("Runtime\.enable"\)(?!\.then|\.catch)/g,
    (match, session) => {
      count++;
      return `${PATCH_MARKER}${session}.send("Runtime.enable").then(function(){${session}.send("Runtime.disable",{}).catch(function(){})})`;
    }
  );

  // Pattern: session2._sendMayFail("Runtime.enable")
  code = code.replace(
    /(\w+)\._sendMayFail\("Runtime\.enable"\)/g,
    (match, session) => {
      count++;
      return `${PATCH_MARKER}(function(){${session}._sendMayFail("Runtime.enable");setTimeout(function(){${session}._sendMayFail("Runtime.disable")},50)})()`;
    }
  );

  // Pattern: this._client.send("Runtime.enable", {})
  code = code.replace(
    /this\._client\.send\("Runtime\.enable",\s*\{\}\)/g,
    (match) => {
      count++;
      return `${PATCH_MARKER}this._client.send("Runtime.enable", {}).then(()=>{this._client.send("Runtime.disable",{}).catch(()=>{})})`;
    }
  );

  // Pattern: this._nodeSession.send("Runtime.enable", {})
  code = code.replace(
    /this\._nodeSession\.send\("Runtime\.enable",\s*\{\}\)/g,
    (match) => {
      count++;
      return `${PATCH_MARKER}this._nodeSession.send("Runtime.enable", {}).then(()=>{this._nodeSession.send("Runtime.disable",{}).catch(()=>{})})`;
    }
  );

  fs.writeFileSync(BUNDLE_PATH, code, 'utf-8');
  console.log(`✅ Patched ${count} Runtime.enable calls`);
  console.log('🔧 Playwright will now auto-disable Runtime after each enable');
}

main();
