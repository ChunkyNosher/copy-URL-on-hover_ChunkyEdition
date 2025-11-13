# Automated GitHub Workflow for Building and Releasing Firefox Extension (.xpi)

**Purpose**: Create a robust GitHub Actions workflow that automatically:

1. Installs Node.js & dependencies
2. Builds the modular extension (bundles /src to /dist)
3. Packages the extension as a .xpi (from dist/)
4. Uploads the .xpi to the release when a new release/tag is created

---

## File Location

```
.github/workflows/build-release.yml
```

---

## Example Workflow File

```yaml
name: Build & Release .xpi Extension

on:
  push:
    tags:
      - "v*"

jobs:
  build:
    name: Build & Package Extension
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"

      - name: Install Dependencies
        run: npm install

      - name: Build Extension
        run: npm run build

      - name: Package .xpi Archive
        working-directory: ./dist
        run: |
          zip -r -FS ../copy-url-hover-${{ github.ref_name }}.xpi * -x "*.DS_Store"

      - name: Upload .xpi to GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: copy-url-hover-*.xpi
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Key Steps Explained

- **Triggers on tag push** (e.g., v1.5.8.2)
- **Installs Node.js 18** (compatible with Rollup and modern npm)
- **npm install** to get all dev/build dependencies
- **npm run build** to generate /dist files (bundled content.js, assets, manifest, etc.)
- **Packages contents of /dist** directory as .xpi using `zip` (critical!)
- **Uploads the .xpi** to the release for that tag using the GitHub-provided token

---

## Integration Tips

- The .xpi **MUST be created from the dist/ folder**, not the repo root.
- Keep Rollup, copy-assets, and the build process in sync with package.json and BUILD.md
- Use `${{ github.ref_name }}` for the .xpi file so each release is versioned automatically.
- Make sure `.xpi` files are listed under `files:` in the `Upload .xpi to GitHub Release` step so they're attached to every release.

---

## Manual Testing

**To test the workflow:**

1. Push a tag like `v1.5.8.2` to GitHub:
   ```bash
   git tag v1.5.8.2
   git push origin v1.5.8.2
   ```
2. Wait for the GitHub Actions run to complete
3. The built .xpi should be available on the GitHub Release tagged `v1.5.8.2`
4. Download and install .xpi in Firefox/Zen Browser (`about:debugging`)

---

## Troubleshooting

- If .xpi is missing files, verify `/dist` has all expected artifacts before zipping
- If build fails, check npm logs for missing dependencies or syntax errors
- If .xpi is still "corrupt" on install, confirm `content.js` is **bundled** and present in the **root** of the .xpi archive (not inside /src or /dist)
- If secret errors, make sure `GITHUB_TOKEN` is included (default for GitHub Actions)

---

**END OF DOCUMENT**

This .md file serves as both a how-to and a template for adding robust, automated Firefox extension builds/releases with correct .xpi packaging.
