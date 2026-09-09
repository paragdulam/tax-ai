claude

# TaxAI Desktop

A cross-platform desktop application (Windows, macOS, Linux) built with [Tauri](https://tauri.app), implementing the TaxShield AI UI: Dashboard, Statements, Review, and Insights screens.

## Prerequisites

- [Node.js](https://nodejs.org/) (for the Tauri CLI)
- [Rust](https://www.rust-lang.org/tools/install) via `rustup`
- Platform-specific dependencies for Tauri - see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Microsoft Visual Studio C++ Build Tools and WebView2
  - **Linux**: WebKitGTK and related system packages (see the Tauri guide for your distro)

## Setup

```bash
npm install
```

## Run in development

```bash
npm run dev
```

This compiles the Tailwind CSS and opens the app in a native window. If you're editing styles/markup, run `npm run watch:css` in a separate terminal to recompile CSS on save while `npm run dev` is running.

## Build a release package

```bash
npm run build
```

This compiles the Tailwind CSS and writes the app to `src-tauri/target/release/`, with an installable OS-specific bundle (e.g. `.app`/`.dmg` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.AppImage` on Linux) under `src-tauri/target/release/bundle/`. Build on each target OS to produce that OS's package.

## Styling

All styling is Tailwind CSS compiled locally at build time (via `npm run build:css` / `watch:css`) into `src/styles/tailwind.css` — no CDN dependency at runtime. The Tailwind theme (colors, type scale, spacing) lives in `tailwind.config.js` and matches the `Fiscal Precision Desktop` design system. Fonts (Inter, JetBrains Mono, Material Symbols Outlined) are self-hosted under `src/fonts/`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
