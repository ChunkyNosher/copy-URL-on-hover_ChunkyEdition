# Build Instructions for Copy URL on Hover v1.5.8.2

## Overview

Starting with v1.5.8.2, this extension uses a **modular architecture** with a build system to bundle the source code into an optimized distribution.

## Architecture

### Source Structure (src/)
```
src/
├── core/                    # Core modules
│   ├── config.js           # Configuration management
│   ├── state.js            # State management
│   └── events.js           # Event bus system
├── features/
│   └── url-handlers/       # URL detection modules (104 handlers)
│       ├── index.js        # Main registry
│       ├── social-media.js # Social media platforms
│       ├── video.js        # Video platforms
│       ├── developer.js    # Developer platforms
│       ├── blogging.js     # Blogging platforms
│       ├── ecommerce.js    # E-commerce platforms
│       ├── image-design.js # Image & design platforms
│       ├── news-discussion.js # News & discussion platforms
│       ├── entertainment.js # Entertainment platforms
│       ├── gaming.js       # Gaming platforms
│       ├── learning.js     # Learning platforms
│       ├── other.js        # Other platforms
│       └── generic.js      # Generic fallback
├── utils/                  # Utility modules
│   ├── debug.js           # Debug utilities
│   ├── dom.js             # DOM manipulation helpers
│   └── browser-api.js     # Browser API wrappers
└── content.js             # Main entry point

```

### Build Output (dist/)
The build process:
1. Bundles all modules using Rollup
2. Generates optimized `content.js` (63KB vs original 180KB)
3. Copies static assets (background.js, popup files, icons, etc.)
4. Updates manifest.json with correct version

## Prerequisites

- Node.js 14.0.0 or higher
- npm (comes with Node.js)

## Build Commands

### Install Dependencies
```bash
npm install
```

### Development Build
```bash
npm run build
```
Creates `dist/` folder with bundled extension and source maps.

### Production Build
```bash
npm run build:prod
```
Creates optimized build without source maps (for release).

### Clean Build
```bash
npm run clean
```
Removes the `dist/` folder.

### Watch Mode
```bash
npm run watch
```
Automatically rebuilds when source files change (does not copy assets).

## Testing the Extension

### In Firefox
1. Build the extension: `npm run build`
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Navigate to `dist/` folder and select `manifest.json`

### In Zen Browser
Same process as Firefox - Zen Browser uses the same extension system.

## File Size Comparison

| File | Original (v1.5.8.1) | Modular (v1.5.8.2) | Reduction |
|------|--------------------|--------------------|-----------|
| content.js | 180KB | 63KB | 65% |
| Total Lines | 5,834 | 2,324 (bundled) | 60% |

## Development Workflow

1. Make changes to files in `src/`
2. Run `npm run build` to test
3. Load temporary add-on in Firefox to test changes
4. Iterate as needed

## Key Benefits of Modular Architecture

✅ **Maintainability** - Easier to find and fix bugs
✅ **Organization** - Clear separation of concerns
✅ **Scalability** - Add features without bloating core
✅ **Performance** - Smaller bundled file size
✅ **Collaboration** - Multiple developers can work simultaneously
✅ **Testing** - Modules can be tested in isolation

## Troubleshooting

### Build Errors
- Make sure Node.js is installed: `node --version`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check for syntax errors in source files

### Extension Not Loading
- Verify `dist/manifest.json` exists and has version 1.5.8.2
- Check browser console for errors (F12)
- Try unloading and reloading the extension

### Source Maps Not Generated
- Use development build: `npm run build` (not `npm run build:prod`)
- Check for `dist/content.js.map` file

## Documentation

- **Architecture Guide**: `docs/manual/modular-architecture-refactor.md`
- **Repository Structure**: See main `README.md`
- **Agent Instructions**: `.github/agents/*.md` (updated for v1.5.8.2)

## Legacy Code

The original monolithic `content.js` has been preserved as `content-legacy.js` for reference.
