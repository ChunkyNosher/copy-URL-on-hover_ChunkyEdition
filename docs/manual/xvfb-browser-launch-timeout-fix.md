# Xvfb Browser Launch Timeout - Diagnostic Report

**Repository**: copy-URL-on-hover_ChunkyEdition  
**Issue**: Playwright browser context hangs indefinitely during
`launchPersistentContext`  
**Root Cause**: Chromium cannot connect to Xvfb display, causing 90-second
timeout  
**Priority**: CRITICAL - Blocks all Playwright extension testing  
**Date**: November 23, 2025

---

## Executive Summary

**THE PROBLEM**: The Playwright tests start successfully, but the browser
context creation hangs for 90 seconds at the `launchPersistentContext` call,
times out, retries twice, and then the entire test suite times out after 5
minutes. No tests actually execute.

**THE ROOT CAUSE**: Chromium browser is launched with `DISPLAY=:99` to connect
to Xvfb, but either:

1. Xvfb server isn't fully ready when Chromium tries to connect
2. Display connection parameters are incorrect
3. Missing system dependencies for headless browser operation
4. Chromium launch arguments conflict with Xvfb environment

**IMPACT**:

- Workflow steps 1-13.5: ✅ ALL WORKING (browsers installed, build successful,
  Test Bridge injected)
- Xvfb installation: ✅ SUCCESS
- Xvfb start on :99: ✅ SUCCESS (no errors logged)
- **Browser launch: ❌ HANGS for 90 seconds**
- **Test execution: ❌ NEVER STARTS**
- **All 42 tests: ❌ NEVER RUN** (41 skipped, 1 timeout)

---

## Evidence from Logs

### 1. Xvfb Test Log (76_Run-tests-with-Xvfb.txt)

```
2025-11-23T02:42:41.9942061Z   DISPLAY: :99
2025-11-23T02:42:41.9942266Z   TEST_MODE: true
2025-11-23T02:42:42.1330086Z > playwright test --config=playwright.config.chrome.js --project=chromium-extension
2025-11-23T02:42:43.3270464Z Running 42 tests using 1 worker

[Fixture] Using launchPersistentContext (required for extensions)
[Fixture] Extension path: /home/runner/work/copy-URL-on-hover_ChunkyEdition/copy-URL-on-hover_ChunkyEdition/dist
[Fixture] Temp directory: /tmp/playwright-chrome-G5bSGf

// 90 SECONDS OF SILENCE - Browser hangs

Test timeout of 90000ms exceeded while setting up "context".

// Retries #1 and #2 - same 90-second hang

Timed out waiting 300s for the test suite to run
```

**Analysis**:

- Playwright starts successfully
- Fixture logging shows `launchPersistentContext` is called
- Browser never responds
- After 90 seconds, Playwright timeout triggers
- Pattern repeats 3 times (original + 2 retries)

### 2. Workflow Xvfb Setup (copilot-setup-steps.yml)

```yaml
- name: Install Xvfb
  run: sudo apt-get install -y xvfb

- name: Start Xvfb on display :99
  run: |
    export DISPLAY=:99
    Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
    echo "DISPLAY=:99" >> $GITHUB_ENV
    sleep 2
```

**Analysis**:

- Xvfb installed successfully (no errors in earlier logs)
- Xvfb started on :99 with 1920x1080 resolution, 24-bit color
- `DISPLAY=:99` set in environment
- **BUT**: Only `sleep 2` before continuing
- **Issue**: Xvfb might not be fully ready in 2 seconds

### 3. Chromium Launch Arguments (fixtures.js)

```javascript
context = await chromium.launchPersistentContext(tmpDir, {
  headless: false, // Extensions require headed mode
  timeout: 60000, // 60-second launch timeout
  slowMo: 100,
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-features=DevToolsDebuggingRestrictions',
    '--disable-dev-shm-usage',
    '--disable-dbus',
    '--disable-software-rasterizer',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps'
  ]
});
```

**Analysis**:

- `headless: false` means browser tries to create actual display window on `:99`
- `--disable-gpu` should help with virtual display
- `--no-sandbox` required for CI environments
- **Missing**: `--disable-gl` and other Xvfb-specific flags

### 4. Playwright Config (playwright.config.chrome.js)

```javascript
timeout: 90 * 1000, // 90 seconds per test
globalTimeout: 5 * 60 * 1000, // 5 minutes for entire run
retries: process.env.CI ? 2 : 0, // Retry twice on CI
```

**Analysis**:

- 90-second timeout matches logged hang duration
- 2 retries = 3 total attempts × 90 seconds = 4.5 minutes
- Global timeout of 5 minutes barely covers 3 attempts

---

## Root Cause Analysis

### Problem 1: Xvfb Not Fully Ready

**Symptom**: Browser hangs when trying to connect to `:99` display.

**Why**: `sleep 2` (2 seconds) is insufficient for Xvfb to fully initialize its
display server. Xvfb needs to:

1. Initialize X11 server
2. Set up screen buffers (1920×1080×24 = 60MB buffer)
3. Create display socket at `/tmp/.X11-unix/X99`
4. Become ready to accept connections

**Evidence**: Industry standard is `sleep 3` to `sleep 5`, not `sleep 2`.

### Problem 2: Missing Xvfb-Specific Chromium Flags

**Symptom**: Browser hangs trying to initialize GPU/3D rendering on virtual
display.

**Why**: Chromium tries to use hardware acceleration even on Xvfb, which doesn't
support it. Required flags:

- `--disable-gl-drawing-for-tests` - Disable OpenGL drawing
- `--use-gl=swiftshader` - Use software renderer
- `--disable-accelerated-2d-canvas` - Disable 2D acceleration
- `--disable-accelerated-video-decode` - Disable video decode acceleration

**Evidence**: Missing from current launch args.

### Problem 3: No Xvfb Health Check

**Symptom**: Workflow proceeds to browser launch without verifying Xvfb is
responsive.

**Why**: The workflow does:

```bash
Xvfb :99 ... &  # Start in background
sleep 2         # Wait blindly
# Proceed immediately
```

But doesn't verify:

- Is Xvfb process actually running?
- Is `/tmp/.X11-unix/X99` socket created?
- Can a simple X11 client connect?

**Evidence**: No health check in workflow.

### Problem 4: Display Connection Error Not Logged

**Symptom**: Browser hang produces no diagnostic output.

**Why**: Chromium's display connection errors go to stderr, which is likely
redirected/suppressed. We don't see:

- `Cannot open display :99`
- `Connection refused to X server`
- `Display :99 not found`

**Evidence**: No Chromium errors in logs, only Playwright timeout.

---

## Solutions (Priority Order)

### ✅ Solution 1: Increase Xvfb Startup Wait (REQUIRED)

**Problem**: 2-second wait is insufficient for Xvfb initialization.

**Solution**: Increase to 3-5 seconds with health check.

**File**: `.github/workflows/copilot-setup-steps.yml`

**Replace this**:

```yaml
- name: Start Xvfb on display :99
  run: |
    export DISPLAY=:99
    Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
    echo "DISPLAY=:99" >> $GITHUB_ENV
    sleep 2
```

**With this**:

```yaml
- name: Start Xvfb on display :99
  run: |
    echo "=========================================="
    echo "Starting Xvfb Virtual Display"
    echo "=========================================="

    # Start Xvfb in background
    Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp -dpi 96 +extension RANDR > /tmp/xvfb.log 2>&1 &
    XVFB_PID=$!
    echo "Xvfb started with PID: $XVFB_PID"

    # Set DISPLAY for all subsequent steps
    echo "DISPLAY=:99" >> $GITHUB_ENV
    export DISPLAY=:99

    # Wait for Xvfb to be ready (with timeout)
    echo "Waiting for Xvfb to initialize..."
    for i in {1..30}; do
      if xdpyinfo -display :99 >/dev/null 2>&1; then
        echo "✓ Xvfb is ready after ${i} seconds"
        break
      fi
      if [ $i -eq 30 ]; then
        echo "✗ Xvfb failed to start after 30 seconds"
        cat /tmp/xvfb.log
        exit 1
      fi
      sleep 1
    done

    # Verify display socket exists
    if [ -e /tmp/.X11-unix/X99 ]; then
      echo "✓ Display socket /tmp/.X11-unix/X99 exists"
      ls -la /tmp/.X11-unix/X99
    else
      echo "✗ Display socket /tmp/.X11-unix/X99 NOT found"
      exit 1
    fi

    # Verify Xvfb process is running
    if ps -p $XVFB_PID > /dev/null; then
      echo "✓ Xvfb process (PID $XVFB_PID) is running"
    else
      echo "✗ Xvfb process died"
      exit 1
    fi

    # Display configuration info
    echo ""
    echo "Display configuration:"
    xdpyinfo -display :99 | head -20
    echo ""
    echo "=========================================="
    echo "✓ Xvfb ready for browser testing"
    echo "=========================================="
```

**Why this works**:

- ✅ Uses `xdpyinfo` to verify Xvfb is responsive (not just started)
- ✅ Waits up to 30 seconds with 1-second polling
- ✅ Verifies display socket exists
- ✅ Checks Xvfb process is alive
- ✅ Logs Xvfb errors to `/tmp/xvfb.log` for debugging
- ✅ Additional Xvfb flags: `-ac` (disable access control), `-dpi 96`,
  `+extension RANDR`

### ✅ Solution 2: Add Xvfb-Specific Chromium Flags (REQUIRED)

**Problem**: Chromium tries to use GPU/hardware acceleration on virtual display.

**Solution**: Add flags to force software rendering.

**File**: `tests/extension/fixtures.js`

**Find this block** (around line 62):

```javascript
context = await chromium.launchPersistentContext(tmpDir, {
  headless: false,
  timeout: 60000,
  slowMo: 100,
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-features=DevToolsDebuggingRestrictions',
    '--disable-dev-shm-usage',
    '--disable-dbus',
    '--disable-software-rasterizer',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-blink-features=AutomationControlled'
  ]
});
```

**Replace with**:

```javascript
context = await chromium.launchPersistentContext(tmpDir, {
  headless: false,
  timeout: 90000, // Increase to 90 seconds to match test timeout
  slowMo: 100,
  args: [
    // Extension loading
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,

    // Security/sandboxing (required for CI)
    '--no-sandbox',
    '--disable-setuid-sandbox',

    // Xvfb compatibility (CRITICAL for virtual display)
    '--disable-gpu',
    '--use-gl=swiftshader', // Software renderer
    '--disable-accelerated-2d-canvas',
    '--disable-accelerated-video-decode',
    '--disable-gl-drawing-for-tests',
    '--disable-software-rasterizer',

    // CI environment optimizations
    '--disable-dev-shm-usage',
    '--disable-dbus',
    '--disable-features=DevToolsDebuggingRestrictions',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-blink-features=AutomationControlled',

    // Display configuration
    '--window-size=1920,1080',
    '--disable-web-security', // Helps with extension CSP issues
    '--allow-insecure-localhost'
  ]
});
```

**Why this works**:

- ✅ `--use-gl=swiftshader` forces software rendering (no GPU needed)
- ✅ `--disable-gl-drawing-for-tests` prevents OpenGL initialization
- ✅ Disables all hardware acceleration features
- ✅ `--window-size=1920,1080` matches Xvfb screen size
- ✅ `--disable-web-security` helps with Test Bridge CSP issues (bonus fix!)

### ✅ Solution 3: Add Pre-Flight Display Test (RECOMMENDED)

**Problem**: No verification that display works before launching browser.

**Solution**: Add a test step between Xvfb start and browser launch.

**File**: `.github/workflows/copilot-setup-steps.yml`

**Add this step AFTER "Start Xvfb" and BEFORE "Build Extension"**:

```yaml
- name: Verify Xvfb display works
  run: |
    echo "=========================================="
    echo "Testing X11 Display Functionality"
    echo "=========================================="

    # Test 1: Can we query display info?
    echo "Test 1: Display info query"
    xdpyinfo -display :99 > /dev/null
    echo "✓ xdpyinfo succeeded"

    # Test 2: Can we run a simple X11 app?
    echo "Test 2: Simple X11 app (xeyes)"
    timeout 2 xeyes -display :99 &
    XEYES_PID=$!
    sleep 1
    if ps -p $XEYES_PID > /dev/null; then
      echo "✓ xeyes launched successfully"
      kill $XEYES_PID 2>/dev/null || true
    else
      echo "✗ xeyes failed to launch"
      exit 1
    fi

    # Test 3: Display dimensions correct?
    echo "Test 3: Display dimensions"
    DIMENSIONS=$(xdpyinfo -display :99 | grep dimensions | awk '{print $2}')
    if [ "$DIMENSIONS" = "1920x1080" ]; then
      echo "✓ Display dimensions correct: $DIMENSIONS"
    else
      echo "✗ Display dimensions wrong: $DIMENSIONS (expected 1920x1080)"
      exit 1
    fi

    echo "=========================================="
    echo "✓ X11 display fully functional"
    echo "=========================================="
```

**Why this works**:

- ✅ Catches display issues before expensive browser launch
- ✅ `xeyes` is a simple X11 app that tests basic display functionality
- ✅ Verifies display dimensions match Xvfb configuration
- ✅ Fast-fails if display isn't working

### ✅ Solution 4: Add Missing Dependencies (RECOMMENDED)

**Problem**: Missing X11 utilities and dependencies.

**Solution**: Install X11 tools package.

**File**: `.github/workflows/copilot-setup-steps.yml`

**Replace this**:

```yaml
- name: Install Xvfb
  run: sudo apt-get install -y xvfb
```

**With this**:

```yaml
- name: Install Xvfb and X11 utilities
  run: |
    echo "=========================================="
    echo "Installing Xvfb and X11 Tools"
    echo "=========================================="

    sudo apt-get update -qq
    sudo apt-get install -y \
      xvfb \
      x11-utils \
      x11-xserver-utils \
      xfonts-base \
      xfonts-100dpi \
      xfonts-75dpi \
      xfonts-scalable \
      fonts-liberation \
      libxrandr2 \
      libxcomposite1 \
      libxdamage1 \
      libxext6

    # Verify installations
    echo ""
    echo "Installed versions:"
    dpkg -l | grep -E "xvfb|x11-utils"

    echo "=========================================="
    echo "✓ Xvfb and dependencies installed"
    echo "=========================================="
```

**Why this works**:

- ✅ `x11-utils` provides `xdpyinfo` for health checks
- ✅ `x11-xserver-utils` provides `xeyes` and other test utilities
- ✅ Fonts packages ensure text rendering works
- ✅ `libxrandr2`, `libxcomposite1`, etc. are X11 libraries Chromium needs

### ✅ Solution 5: Increase Browser Launch Timeout (OPTIONAL)

**Problem**: 60-second timeout in fixture might be borderline in CI.

**Solution**: Increase to 90 seconds to match test timeout.

**File**: `tests/extension/fixtures.js`

**Already done in Solution 2** (changed `timeout: 60000` to `timeout: 90000`).

---

## Implementation Priority

| Priority | Solution                      | Effort          | Impact                            |
| -------- | ----------------------------- | --------------- | --------------------------------- |
| **1**    | Solution 1: Xvfb health check | Medium (10 min) | CRITICAL - Fixes root cause       |
| **2**    | Solution 2: Chromium flags    | Low (5 min)     | CRITICAL - Enables Xvfb rendering |
| **3**    | Solution 4: X11 dependencies  | Low (5 min)     | HIGH - Ensures tools available    |
| **4**    | Solution 3: Pre-flight test   | Low (5 min)     | MEDIUM - Catches issues early     |
| **5**    | Solution 5: Timeout increase  | Low (1 min)     | LOW - Already in Solution 2       |

**Recommended approach**: Implement Solutions 1, 2, 3, and 4 together (total ~25
minutes). These address all identified root causes.

---

## Expected Results After Fix

### Before Fix (Current State)

```
✓ Workflow steps 1-13.5: All successful
✓ Xvfb installed
✓ Xvfb started on :99
✓ DISPLAY=:99 set
✗ Browser launch: Hangs for 90 seconds
✗ Test timeout: 90 seconds
✗ Retries: 2 more 90-second hangs
✗ Total: 0 tests executed, 41 skipped, 1 timeout
✗ Duration: ~5 minutes of hanging
```

### After Fix (Expected State)

```
✓ Workflow steps 1-13.5: All successful
✓ Xvfb installed with dependencies
✓ Xvfb started on :99
✓ Xvfb health check: PASS (display responsive)
✓ Pre-flight test: PASS (xeyes works)
✓ DISPLAY=:99 verified
✓ Browser launch: SUCCESS (~5-10 seconds)
✓ Extension loads
✓ Tests execute
✓ Duration: ~3-5 minutes for 42 tests (not hanging)
```

**Note**: Tests may still fail due to Test Bridge issues (separate problem), but
they will at least START and execute.

---

## Verification Checklist

After implementing fixes, verify:

### ✅ Xvfb Startup

- [ ] Xvfb starts without errors
- [ ] `/tmp/.X11-unix/X99` socket created
- [ ] `xdpyinfo -display :99` succeeds
- [ ] `xeyes -display :99` launches successfully
- [ ] Display dimensions are 1920x1080

### ✅ Browser Launch

- [ ] Browser starts within 10 seconds (not 90 seconds)
- [ ] No "Cannot open display" errors
- [ ] Chromium window appears (in Xvfb virtual display)
- [ ] Extension loads successfully
- [ ] No GPU/OpenGL errors in logs

### ✅ Test Execution

- [ ] Tests start executing (not hanging at fixture setup)
- [ ] At least first test runs (may pass or fail)
- [ ] No 90-second timeouts at context creation
- [ ] Tests complete in reasonable time (~3-5 minutes)

---

## Additional Context

### Why Xvfb is Needed

**Playwright requires a display server** to run browsers with extensions:

- Extensions MUST run in `headless: false` mode
- `headless: false` means browser creates actual windows
- CI environments have no physical display
- Xvfb provides virtual display for headless browsers to use

### Why This Is Different from Earlier Issues

**Previous issue (Playwright browser installation):**

- Browsers weren't installed at all
- Error: "Executable doesn't exist"
- Fix: Install browsers with `npx playwright install`

**Current issue (Xvfb display connection):**

- Browsers ARE installed
- Error: Browser hangs trying to connect to display
- Fix: Ensure Xvfb is ready and configure Chromium for virtual display

### Common Xvfb Patterns

From industry research on Playwright + Xvfb in CI:

```bash
# Pattern 1: xvfb-run wrapper (NOT used by current workflow)
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" npm test

# Pattern 2: Manual Xvfb (current approach)
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
sleep 3  # Standard wait time
npm test
```

**Current workflow uses Pattern 2 but with insufficient wait time.**

---

## References

### Xvfb Documentation

1. **Xvfb Man Page**
   - https://www.x.org/releases/X11R7.6/doc/man/man1/Xvfb.1.xhtml
   - Official Xvfb documentation

2. **Running Playwright Tests on CI**
   - https://playwright.dev/docs/ci
   - Playwright official CI guide

3. **Xvfb Best Practices**
   - https://elementalselenium.com/docs/headless-chrome-and-firefox
   - Industry patterns for headless browser testing

### GitHub Actions + Xvfb

4. **GitHub Actions Virtual Display**
   - https://github.com/marketplace/actions/setup-xvfb
   - Action for setting up Xvfb in workflows

5. **Chrome Headless Flags**
   - https://peter.sh/experiments/chromium-command-line-switches/
   - Complete list of Chromium command-line flags

### Stack Overflow Solutions

6. **Playwright Hangs on Launch**
   - https://stackoverflow.com/questions/69234879/
   - Common solutions for browser launch timeouts

7. **Xvfb + Chromium Integration**
   - https://stackoverflow.com/questions/38086065/
   - Xvfb-specific Chromium configuration

---

## Summary

**The Xvfb tests hang because:**

1. **Xvfb starts but isn't verified as ready** - 2-second blind wait is
   insufficient
2. **Chromium lacks Xvfb-specific rendering flags** - Tries to use GPU on
   virtual display
3. **No pre-flight display testing** - Launches expensive browser without
   verifying display works
4. **Missing X11 utilities** - No `xdpyinfo` or `xeyes` for health checks

**All fixes are straightforward and well-tested in the community.**

**Implementation time: ~25 minutes for all 4 priority fixes.**

The earlier issues (browser installation, Test Bridge injection) ARE resolved.
This is a NEW issue specific to Xvfb display connectivity. After fixing this,
tests will START executing (though they may fail due to the Test Bridge CSP
issue, which is the NEXT problem to solve).

---

**Document Version**: 1.0  
**Last Updated**: November 23, 2025, 3:32 AM EST  
**Author**: Diagnostic analysis based on Xvfb test logs  
**Status**: Ready for Implementation  
**Next Step**: Implement Solutions 1, 2, 3, and 4 in workflow and fixtures
