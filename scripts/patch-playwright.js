#!/usr/bin/env node
/**
 * Patch Playwright 1.60's coreBundle.js to mitigate Runtime.Enable CDP detection.
 *
 * After each Runtime.enable call resolves, immediately sends Runtime.disable
 * to stop Runtime.consoleAPICalled events (used by Pixelscan/Cloudflare to detect automation).
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
    console.log(code.includes(PATCH_MARKER) ? '✅ Patched' : '❌ Not patched');
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

  let code = fs.readFileSync(BUNDLE_PATH, 'utf-8');

  if (code.includes(PATCH_MARKER)) {
    console.log('✅ Already patched');
    return;
  }

  // Backup
  fs.copyFileSync(BUNDLE_PATH, BACKUP_PATH);
  console.log('📦 Backup saved');

  let count = 0;

  // Strategy: We DON'T modify the Runtime.enable calls themselves.
  // Instead, we add a global interceptor at the TOP of the bundle that
  // hooks into the CDP send mechanism to auto-disable Runtime.
  //
  // The safest approach: Find where CDPSession.send is defined and wrap it.
  // In the bundled code, we look for the send method pattern.

  // Actually, the SIMPLEST and SAFEST approach:
  // Add a snippet at the very top that monkey-patches the global WebSocket
  // message handling to intercept Runtime.enable responses and send disable.
  // But that's too complex.

  // REAL safest approach: Just comment out Runtime.enable calls entirely
  // and replace with a resolved promise. Playwright will still work because
  // it falls back to creating isolated worlds when contexts aren't available.
  // BUT this might break page.evaluate() — too risky.

  // FINAL approach: The patch that actually works is to NOT touch the bundle,
  // but instead set an environment variable that makes our CDP session
  // send Runtime.disable after Playwright's internal enable.
  // We already do this in profile-manager.ts via the CDP session we create.
  // The issue is Playwright's INTERNAL sessions (not exposed to us).

  // The ONLY reliable fix for bundled Playwright 1.60:
  // Replace "Runtime.enable" string literal with a version that auto-disables.
  // We need to be careful with `this` context.

  // Pattern 1: this._client.send("Runtime.enable", {})
  // This is inside a class method, `this` refers to the class instance.
  // Arrow functions preserve `this`, so: .then(() => this._client.send("Runtime.disable", {}).catch(() => {}))
  // BUT this is inside an array (Promise.all), so adding .then changes the resolved value.
  // Solution: Use .then(r => (this._client.send("Runtime.disable",{}).catch(()=>{}), r))
  // This preserves the resolved value while also sending disable.
  code = code.replace(
    'this._client.send("Runtime.enable", {})',
    `${PATCH_MARKER}this._client.send("Runtime.enable", {}).then(r=>(this._client.send("Runtime.disable",{}).catch(()=>{}),r))`
  );
  count++;

  // Pattern 2: session2._sendMayFail("Runtime.enable");
  // _sendMayFail is fire-and-forget. We just add disable after.
  // Replace with: session2._sendMayFail("Runtime.enable"); session2._sendMayFail("Runtime.disable");
  code = code.replace(
    /session2\._sendMayFail\("Runtime\.enable"\);/g,
    (match) => {
      count++;
      return `${PATCH_MARKER}session2._sendMayFail("Runtime.enable"); session2._sendMayFail("Runtime.disable");`;
    }
  );

  // Pattern 3: session2.send("Runtime.enable", {}).catch((e) => {
  // This has a .catch already. We insert .then before .catch.
  code = code.replace(
    'session2.send("Runtime.enable", {}).catch((e) => {',
    `${PATCH_MARKER}session2.send("Runtime.enable", {}).then(()=>session2.send("Runtime.disable",{}).catch(()=>{})).catch((e) => {`
  );
  count++;

  // Pattern 4: session2.send("Runtime.enable")  (no params, in arrays)
  // These are inside Promise.all arrays. We preserve the value.
  code = code.replace(
    /session2\.send\("Runtime\.enable"\)/g,
    (match) => {
      count++;
      return `${PATCH_MARKER}session2.send("Runtime.enable").then(r=>(session2.send("Runtime.disable",{}).catch(()=>{}),r))`;
    }
  );

  // Pattern 5: await this._nodeSession.send("Runtime.enable", {});
  code = code.replace(
    'await this._nodeSession.send("Runtime.enable", {});',
    `${PATCH_MARKER}await this._nodeSession.send("Runtime.enable", {}); await this._nodeSession.send("Runtime.disable", {}).catch(()=>{});`
  );
  count++;

  // Pattern 6: workerSession.send("Runtime.enable")
  code = code.replace(
    'workerSession.send("Runtime.enable")',
    `${PATCH_MARKER}workerSession.send("Runtime.enable").then(r=>(workerSession.send("Runtime.disable",{}).catch(()=>{}),r))`
  );
  count++;

  fs.writeFileSync(BUNDLE_PATH, code, 'utf-8');
  console.log(`✅ Patched ${count} Runtime.enable calls`);
}

main();
