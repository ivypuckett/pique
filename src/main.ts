import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { hydrateSession } from "./lib/store.ts";
import { hydrateSettings, settings } from "./lib/settings/store.ts";

// Reflect the chosen daisyui theme onto <html data-theme>. The compiled theme set
// lives in app.css (kept in lockstep with THEMES in settings/store.ts).
settings.subscribe((s) => {
  document.documentElement.dataset.theme = s.appearance.theme;
});

// Load persisted config from ~/.pique before first render so the app doesn't flash
// the default layout/theme. In web-dev (no backend) both resolve to defaults at once.
// Wrapped (not top-level await) because the build target predates module TLA.
//
// Sequenced, not concurrent: hydrateSession reads the OLD settings.workspace.defaultDir
// to seed the root workspace's cwd on a pre-root layout, and hydrateSettings persists a
// Settings object that no longer carries that field. Running them together left the
// read racing the write, correct only by virtue of a 150ms debounce.
hydrateSession()
  .then(hydrateSettings)
  .then(() => {
    mount(App, { target: document.getElementById("app")! });
  });
