// The themes pique ships with, in the same daisyui block format the editor reads and
// writes. They are SEEDS, not built-ins: on first run they are copied into
// ~/.pique/themes.json, and from then on they are ordinary themes the user can edit,
// rename, or delete. Nothing here is compiled into the stylesheet — app.css asks
// daisyui for `themes: false` and every theme is injected at runtime (see themes.ts).
//
// Order is picker order. The daisyui-provided four are copied verbatim out of
// node_modules/daisyui/theme/*.css as of daisyui 5.7.16; the first two are pique's own.
//
// daisyui's `default:` and `prefersdark:` are omitted throughout: pique's theme is an
// explicit setting with no fallback and no system-preference following, so both are
// inert. A pasted theme that declares them keeps them — they just do nothing.

export const SEED_THEMES = `@plugin "daisyui/theme" {
  name: "catppuccin-frappe";
  color-scheme: "dark";
  --color-base-100: #303446; /* base */
  --color-base-200: #292c3c; /* mantle */
  --color-base-300: #232634; /* crust */
  --color-base-content: #c6d0f5; /* text */
  --color-primary: #8caaee; /* blue */
  --color-primary-content: #232634; /* crust */
  --color-secondary: #ca9ee6; /* mauve */
  --color-secondary-content: #232634; /* crust */
  --color-accent: #81c8be; /* teal */
  --color-accent-content: #232634; /* crust */
  --color-neutral: #414559; /* surface0 */
  --color-neutral-content: #c6d0f5; /* text */
  --color-info: #85c1dc; /* sapphire */
  --color-info-content: #232634; /* crust */
  --color-success: #a6d189; /* green */
  --color-success-content: #232634; /* crust */
  --color-warning: #e5c890; /* yellow */
  --color-warning-content: #232634; /* crust */
  --color-error: #e78284; /* red */
  --color-error-content: #232634; /* crust */
  --radius-selector: 2rem;
  --radius-field: 1rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 1;
  --noise: 1;
}

@plugin "daisyui/theme" {
  /* True black for OLED panels: base-100 is #000 so unlit pixels stay off. The
     accents are catppuccin-mocha — the darker sibling of the frappe palette above,
     so the two themes read as a family. depth/noise are off because both lift the
     base surfaces off pure black, which is the whole point of the theme. */
  name: "amoled";
  color-scheme: "dark";
  --color-base-100: #000000; /* true black */
  --color-base-200: #0b0b12; /* mocha crust, dimmed */
  --color-base-300: #16161f; /* mocha mantle, dimmed */
  --color-base-content: #cdd6f4; /* text */
  --color-primary: #89b4fa; /* blue */
  --color-primary-content: #000000;
  --color-secondary: #cba6f7; /* mauve */
  --color-secondary-content: #000000;
  --color-accent: #94e2d5; /* teal */
  --color-accent-content: #000000;
  --color-neutral: #313244; /* surface0 */
  --color-neutral-content: #cdd6f4; /* text */
  --color-info: #74c7ec; /* sapphire */
  --color-info-content: #000000;
  --color-success: #a6e3a1; /* green */
  --color-success-content: #000000;
  --color-warning: #f9e2af; /* yellow */
  --color-warning-content: #000000;
  --color-error: #f38ba8; /* red */
  --color-error-content: #000000;
  --radius-selector: 2rem;
  --radius-field: 1rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}

@plugin "daisyui/theme" {
  name: "dark";
  color-scheme: "dark";
  --color-base-100: oklch(25.33% 0.016 252.42);
  --color-base-200: oklch(23.26% 0.014 253.1);
  --color-base-300: oklch(21.15% 0.012 254.09);
  --color-base-content: oklch(97.807% 0.029 256.847);
  --color-primary: oklch(58% 0.233 277.117);
  --color-primary-content: oklch(96% 0.018 272.314);
  --color-secondary: oklch(65% 0.241 354.308);
  --color-secondary-content: oklch(94% 0.028 342.258);
  --color-accent: oklch(77% 0.152 181.912);
  --color-accent-content: oklch(38% 0.063 188.416);
  --color-neutral: oklch(14% 0.005 285.823);
  --color-neutral-content: oklch(92% 0.004 286.32);
  --color-info: oklch(74% 0.16 232.661);
  --color-info-content: oklch(29% 0.066 243.157);
  --color-success: oklch(76% 0.177 163.223);
  --color-success-content: oklch(37% 0.077 168.94);
  --color-warning: oklch(82% 0.189 84.429);
  --color-warning-content: oklch(41% 0.112 45.904);
  --color-error: oklch(71% 0.194 13.428);
  --color-error-content: oklch(27% 0.105 12.094);
  --radius-selector: 0.5rem;
  --radius-field: 0.25rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}

@plugin "daisyui/theme" {
  name: "light";
  color-scheme: "light";
  --color-base-100: oklch(100% 0 0);
  --color-base-200: oklch(98% 0 0);
  --color-base-300: oklch(95% 0 0);
  --color-base-content: oklch(21% 0.006 285.885);
  --color-primary: oklch(45% 0.24 277.023);
  --color-primary-content: oklch(93% 0.034 272.788);
  --color-secondary: oklch(65% 0.241 354.308);
  --color-secondary-content: oklch(94% 0.028 342.258);
  --color-accent: oklch(77% 0.152 181.912);
  --color-accent-content: oklch(38% 0.063 188.416);
  --color-neutral: oklch(14% 0.005 285.823);
  --color-neutral-content: oklch(92% 0.004 286.32);
  --color-info: oklch(74% 0.16 232.661);
  --color-info-content: oklch(29% 0.066 243.157);
  --color-success: oklch(76% 0.177 163.223);
  --color-success-content: oklch(37% 0.077 168.94);
  --color-warning: oklch(82% 0.189 84.429);
  --color-warning-content: oklch(41% 0.112 45.904);
  --color-error: oklch(71% 0.194 13.428);
  --color-error-content: oklch(27% 0.105 12.094);
  --radius-selector: 0.5rem;
  --radius-field: 0.25rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}

@plugin "daisyui/theme" {
  name: "dracula";
  color-scheme: "dark";
  --color-base-100: oklch(28.822% 0.022 277.508);
  --color-base-200: oklch(26.805% 0.02 277.508);
  --color-base-300: oklch(24.787% 0.019 277.508);
  --color-base-content: oklch(97.747% 0.007 106.545);
  --color-primary: oklch(75.461% 0.183 346.812);
  --color-primary-content: oklch(15.092% 0.036 346.812);
  --color-secondary: oklch(74.202% 0.148 301.883);
  --color-secondary-content: oklch(14.84% 0.029 301.883);
  --color-accent: oklch(83.392% 0.124 66.558);
  --color-accent-content: oklch(16.678% 0.024 66.558);
  --color-neutral: oklch(39.445% 0.032 275.524);
  --color-neutral-content: oklch(87.889% 0.006 275.524);
  --color-info: oklch(88.263% 0.093 212.846);
  --color-info-content: oklch(17.652% 0.018 212.846);
  --color-success: oklch(87.099% 0.219 148.024);
  --color-success-content: oklch(17.419% 0.043 148.024);
  --color-warning: oklch(95.533% 0.134 112.757);
  --color-warning-content: oklch(19.106% 0.026 112.757);
  --color-error: oklch(68.22% 0.206 24.43);
  --color-error-content: oklch(13.644% 0.041 24.43);
  --radius-selector: 1rem;
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}

@plugin "daisyui/theme" {
  name: "nord";
  color-scheme: "light";
  --color-base-100: oklch(95.127% 0.007 260.731);
  --color-base-200: oklch(93.299% 0.01 261.788);
  --color-base-300: oklch(89.925% 0.016 262.749);
  --color-base-content: oklch(32.437% 0.022 264.182);
  --color-primary: oklch(59.435% 0.077 254.027);
  --color-primary-content: oklch(11.887% 0.015 254.027);
  --color-secondary: oklch(69.651% 0.059 248.687);
  --color-secondary-content: oklch(13.93% 0.011 248.687);
  --color-accent: oklch(77.464% 0.062 217.469);
  --color-accent-content: oklch(15.492% 0.012 217.469);
  --color-neutral: oklch(45.229% 0.035 264.131);
  --color-neutral-content: oklch(89.925% 0.016 262.749);
  --color-info: oklch(69.207% 0.062 332.664);
  --color-info-content: oklch(13.841% 0.012 332.664);
  --color-success: oklch(76.827% 0.074 131.063);
  --color-success-content: oklch(15.365% 0.014 131.063);
  --color-warning: oklch(85.486% 0.089 84.093);
  --color-warning-content: oklch(17.097% 0.017 84.093);
  --color-error: oklch(60.61% 0.12 15.341);
  --color-error-content: oklch(12.122% 0.024 15.341);
  --radius-selector: 1rem;
  --radius-field: 0.25rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}
`;
