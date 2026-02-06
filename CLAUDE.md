# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **static academic project page template** for research papers, deployed via GitHub Pages. There is no build system, no package manager, and no backend — it's pure HTML/CSS/JS.

## Development

```bash
# View locally — just open in a browser
open index.html

# Deploy — push to master, GitHub Pages serves automatically
git push origin master
```

There are no build steps, no tests, no linters configured.

## Architecture

Single-page static site with this structure:

- **`index.html`** — The entire site in one file (~520 lines). Contains TODO comments marking every customization point (title, authors, videos, links, BibTeX, etc.)
- **`static/css/index.css`** — Custom styles using CSS variables (`--primary-color`, etc.) with responsive breakpoints at 480px, 768px, 1024px
- **`static/js/index.js`** — Custom JS: carousel init, dropdown toggle, BibTeX copy-to-clipboard, lazy video autoplay via IntersectionObserver, scroll-to-top button

Third-party libraries are vendored in `static/` (Bulma CSS framework, Font Awesome, bulma-carousel, bulma-slider). jQuery is loaded via CDN.

## Key Conventions

- All customization is done by editing `index.html` directly — search for `TODO` comments to find editable sections
- `.nojekyll` file disables Jekyll processing on GitHub Pages
- Performance: images use `loading="lazy"`, JS uses `defer`, non-critical CSS is async-loaded
- The site includes Schema.org structured data, Open Graph tags, and Twitter Card tags for SEO
