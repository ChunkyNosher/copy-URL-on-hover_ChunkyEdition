export function normalizeManifestPaths(manifestSource) {
  const manifest = JSON.parse(manifestSource);

  if (manifest.background && manifest.background.scripts) {
    manifest.background.scripts = manifest.background.scripts.map(script =>
      script.startsWith('dist/') ? script.replace(/^dist\//, '') : script
    );
  }

  if (manifest.content_scripts) {
    manifest.content_scripts = manifest.content_scripts.map(contentScript => ({
      ...contentScript,
      js: Array.isArray(contentScript.js)
        ? contentScript.js.map(script =>
            script.startsWith('dist/') ? script.replace(/^dist\//, '') : script
          )
        : contentScript.js
    }));
  }

  return JSON.stringify(manifest, null, 2) + '\n';
}
