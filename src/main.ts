import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { hydrateSession } from "./lib/store.ts";
import { hydrateSettings, settings } from "./lib/settings/store.ts";

// Reflect the chosen daisyui theme onto <html data-theme>. Only catppuccin-frappe is
// compiled in app.css today; expanding the theme list is the settings-UI step.
settings.subscribe((s) => {
  document.documentElement.dataset.theme = s.appearance.theme;
});

// Load persisted config from ~/.pique before first render so the app doesn't flash
// the default layout/theme. In web-dev (no backend) both resolve to defaults at once.
// Wrapped (not top-level await) because the build target predates module TLA.
Promise.all([hydrateSession(), hydrateSettings()]).then(() => {
  mount(App, { target: document.getElementById("app")! });
});
