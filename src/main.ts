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
//
// The two font settings override tailwind's own --font-sans and --font-mono tokens at
// the root, which is every `font-mono` class in the app and, through
// --default-font-family, everything else. Overriding the tokens rather than setting
// font-family directly is what keeps that reach: a rule on <html> would lose to every
// utility class further down. An empty setting REMOVES the property rather than writing
// a fallback stack, so the built-in one comes back from the stylesheet and there is one
// definition of it instead of two that can drift. The terminal is not covered — it
// paints its own text, and reads monoFont itself (terminal/Terminal.svelte).
settings.subscribe((s) => {
  document.documentElement.dataset.theme = s.appearance.theme;
  document.documentElement.style.fontSize = `${16 * s.appearance.zoom}px`;
  setFont("--font-sans", s.appearance.uiFont);
  setFont("--font-mono", s.appearance.monoFont);
});

function setFont(token: string, value: string): void {
  const family = value.trim();
  if (family === "") document.documentElement.style.removeProperty(token);
  else document.documentElement.style.setProperty(token, family);
}

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
