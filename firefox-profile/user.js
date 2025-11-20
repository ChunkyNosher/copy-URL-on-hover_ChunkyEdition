// Allow unsigned extensions
user_pref('xpinstall.signatures.required', false);
user_pref('extensions.autoDisableScopes', 0);
user_pref('extensions.enabledScopes', 15);

// Disable update checks
user_pref('app.update.enabled', false);
user_pref('app.update.auto', false);

// Disable first-run pages
user_pref('browser.startup.homepage_override.mstone', 'ignore');
user_pref('startup.homepage_welcome_url', 'about:blank');
user_pref('startup.homepage_welcome_url.additional', '');

// Enable extension debugging
user_pref('devtools.chrome.enabled', true);
user_pref('devtools.debugger.remote-enabled', true);
