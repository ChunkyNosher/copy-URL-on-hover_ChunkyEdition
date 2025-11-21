# Testing with Playwright MCP

This guide explains how to use Playwright MCP servers (Chrome and Firefox) to enable interactive browser testing with the Copilot Coding Agent.

## Overview

The extension can be tested interactively using Playwright MCP, which allows an AI agent to:
- Open browser instances with the extension pre-loaded
- Test features manually using keyboard shortcuts
- Interact with Quick Tabs as a real user would
- Verify behaviors documented in [Issue #47](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/47)

## Prerequisites

1. **Build the extension** (required):
   ```bash
   npm run build:prod
   ```

2. **Install Playwright browsers** (if not already installed):
   ```bash
   npx playwright install chromium firefox
   npx playwright install-deps
   ```

3. **Install web-ext globally** (for Firefox support):
   ```bash
   npm install -g web-ext
   ```

## Quick Start

### Chrome/Chromium Testing

Launch Chrome with the extension loaded:

```bash
npm run mcp:chrome
```

This will:
- Open Chrome with the extension installed from `dist/`
- Use a persistent profile in `chrome-profile/`
- Navigate to `chrome://extensions/` to show the extension is loaded
- Keep the browser open for Playwright MCP interaction

### Firefox Testing

Launch Firefox with the extension loaded:

```bash
npm run mcp:firefox
```

This will:
- Launch Firefox using `web-ext` with the extension installed from `dist/`
- Use a persistent profile in `firefox-profile/`
- Navigate to `about:debugging#/runtime/this-firefox` to show installed extension
- Keep the browser open for Playwright MCP interaction

## MCP Configuration

The repository includes two MCP configuration files for use with Playwright MCP servers:

### Chrome Configuration
**File:** `.playwright-mcp-chrome-config.json`

```json
{
  "browser": {
    "browserName": "chromium",
    "userDataDir": "./chrome-profile",
    "launchOptions": {
      "channel": "chromium",
      "headless": false,
      "args": [
        "--disable-extensions-except=./dist",
        "--load-extension=./dist",
        "--no-sandbox"
      ]
    },
    "contextOptions": {
      "viewport": { "width": 1920, "height": 1080 },
      "permissions": ["clipboard-read", "clipboard-write", "notifications"]
    }
  },
  "capabilities": ["core", "tabs", "wait", "files", "install"],
  "outputDir": "./test-results/chrome"
}
```

### Firefox Configuration
**File:** `.playwright-mcp-firefox-config.json`

```json
{
  "browser": {
    "browserName": "firefox",
    "userDataDir": "./firefox-profile",
    "launchOptions": {
      "headless": false,
      "firefoxUserPrefs": {
        "xpinstall.signatures.required": false,
        "extensions.autoDisableScopes": 0,
        "extensions.enabledScopes": 15,
        "dom.events.testing.asyncClipboard": true
      }
    },
    "contextOptions": {
      "viewport": { "width": 1920, "height": 1080 },
      "permissions": ["clipboard-read", "clipboard-write", "notifications"]
    }
  },
  "capabilities": ["core", "tabs", "wait", "files", "install"],
  "outputDir": "./test-results/firefox"
}
```

## Using Playwright MCP with the Extension

### Starting the MCP Server

#### For Chrome:
```bash
npx @playwright/mcp@latest --config .playwright-mcp-chrome-config.json
```

#### For Firefox:
```bash
npx @playwright/mcp@latest --config .playwright-mcp-firefox-config.json
```

### Connecting to Running Browser

If you've launched the browser using `npm run mcp:chrome` or `npm run mcp:firefox`, the Playwright MCP server can connect to it and control it for testing.

## Testing Quick Tabs Features

Once the browser is running with the extension, you can test the Quick Tabs features interactively:

### Basic Quick Tab Creation (Scenario 1 from #47)

1. Navigate to a page with links (e.g., Wikipedia)
2. Hover over a link
3. Press **Q** to create a Quick Tab
4. Verify the floating Quick Tab appears
5. Drag and resize the Quick Tab
6. Switch to another tab
7. Verify the Quick Tab appears in the same position

### Multiple Quick Tabs (Scenario 2 from #47)

1. Open multiple Quick Tabs from different links
2. Switch between browser tabs
3. Verify all Quick Tabs sync across tabs
4. Close one Quick Tab
5. Verify it disappears from all tabs

### Quick Tab Manager (Scenario 4 from #47)

1. Press **Ctrl+Alt+Z** to open the Quick Tabs Manager
2. Create multiple Quick Tabs
3. Minimize Quick Tabs using the minimize button
4. Verify they appear in the manager
5. Restore Quick Tabs from the manager

### Container Isolation Testing

The extension supports Firefox Container isolation:

1. Open tabs in different containers
2. Create Quick Tabs in each container
3. Verify Quick Tabs are isolated per container
4. Switch between containers
5. Verify Quick Tabs only appear in their respective containers

## Manual Testing with AI Agent

With Playwright MCP configured, you can use the Copilot Coding Agent to:

1. **Navigate to test pages:**
   ```
   Navigate to https://en.wikipedia.org
   ```

2. **Interact with the page:**
   ```
   Hover over a link and press Q to create a Quick Tab
   ```

3. **Test keyboard shortcuts:**
   ```
   Press Ctrl+Alt+Z to open the Quick Tabs Manager
   ```

4. **Verify behaviors:**
   ```
   Create a Quick Tab, switch tabs, and verify it appears in the new tab
   ```

5. **Test drag and resize:**
   ```
   Drag the Quick Tab to the bottom right corner and resize it to 400x300
   ```

## Troubleshooting

### Extension Not Loading in Chrome

- Verify `dist/` directory exists and contains the built extension
- Check that `manifest.json` is in `dist/`
- Try removing `chrome-profile/` and restarting

### Extension Not Loading in Firefox

- Ensure `web-ext` is installed globally: `npm install -g web-ext`
- Verify `dist/manifest.json` has correct Firefox settings
- Check Firefox preferences allow unsigned extensions

### Playwright MCP Not Connecting

- Ensure the browser is running before starting MCP server
- Verify the MCP config file paths are correct (use absolute paths if needed)
- Check that no other process is using the MCP port

### Quick Tabs Not Working

- Verify the extension is enabled in browser extensions page
- Check browser console for errors (F12)
- Ensure the page you're testing on allows extension content scripts

## Advanced Testing

### Automated E2E Tests

While MCP is for interactive testing, you can also run automated tests:

```bash
# Chrome E2E tests
npm run test:extension:chrome

# Firefox E2E tests
npm run test:extension:firefox
```

### Custom Test Scenarios

Create custom test scenarios in `tests/e2e/` following the patterns in existing test files. Use the helper functions from `tests/e2e/helpers/extension-loader.js`.

## References

- [Playwright MCP Documentation](https://github.com/microsoft/playwright-mcp)
- [Playwright Chrome Extensions](https://playwright.dev/docs/chrome-extensions)
- [Quick Tabs Behaviors (Issue #47)](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/47)
- [Extension Architecture](../README.md)

## Notes

- **Chrome/Chromium:** Supports extension loading via command-line args
- **Firefox:** Requires `web-ext` to load extensions properly
- **Headless mode:** Not recommended for interactive testing with MCP
- **Persistent profiles:** Used to maintain extension state between sessions
- **Clipboard permissions:** Required for URL copying functionality
