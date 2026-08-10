import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { hydrateSession } from "./lib/store.ts";
import { hydrateSettings, settings } from "./lib/settings/store.ts";
import { hydrateThemes } from "./lib/settings/themes.ts";
import { fillDisplay } from "./lib/settings/bindings.ts";

// Fill the display immediately, before anything is awaited: the window is created at
// 1200x800 (desktop.ts, which cannot measure the screen) and this is what grows it, so
// every tick of delay is a tick of the small window being visible. Deliberately not
// sequenced with the hydration below — it reads no config and nothing waits on it.
void fillDisplay();

// Reflect the chosen theme onto <html data-theme>. Nothing is compiled: the rule this
// selects is injected from ~/.pique/themes.json by hydrateThemes() below.
//
// Zoom rides on the root font size rather than the CSS `zoom` property: tailwind sizes
// everything in rem, so one number scales the whole UI, and the viewport units the
// shell is built on (h-screen/w-screen) keep meaning the window — which `zoom` would
// scale too, pushing the app off its own edges.
settings.subscribe((s) => {
  document.documentElement.dataset.theme = s.appearance.theme;
  document.documentElement.style.fontSize = `${16 * s.appearance.zoom}px`;
});

// Load persisted config from ~/.pique before first render so the app doesn't flash
// the default layout/theme. In web-dev (no backend) both resolve to defaults at once.
// Wrapped (not top-level await) because the build target predates module TLA.
//
// Sequenced, not concurrent: hydrateSession reads the OLD settings.workspace.defaultDir
// to seed the root workspace's cwd on a pre-root layout, and hydrateSettings persists a
// Settings object that no longer carries that field. Running them together left the
// read racing the write, correct only by virtue of a 150ms debounce.
// hydrateThemes comes last and before the mount: it injects the theme rules, so the app
// would otherwise render with none of the custom properties it is built on, and it can
// correct settings.appearance.theme when that names a theme that no longer exists —
// which only works once hydrateSettings has put the real settings in place.
hydrateSession()
  .then(hydrateSettings)
  .then(hydrateThemes)
  .then(() => {
    mount(App, { target: document.getElementById("app")! });
  });
