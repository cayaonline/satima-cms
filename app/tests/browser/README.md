# Navigation browser regression checks

These checks render the real Admin and Operations shells, stylesheet, navigation controller,
and route/logout controllers in headless Chrome. They do not require a database or access
production: a localhost server serves static files, sessions/logout responses are mocked,
and business-data requests deliberately return an unavailable response. Screenshots therefore
show no real business figures. External requests are blocked.

Use an existing Playwright installation and Chrome (no application dependency is added):

```sh
cd app
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test tests/browser/navigation.mjs
```

If Playwright is resolvable normally, omit `PLAYWRIGHT_MODULE`. `BROWSER_CHANNEL` defaults to
`chrome`. Screenshots are written to ignored `app/test-results/navigation/`; optionally set
`NAV_SCREENSHOTS` to another output directory. Missing Playwright or Chrome is a failure, not
a silently skipped visual test.

The suite covers both portals at 320×480, 320×640, 360×800, 390×844, 430×932,
768×1024, 1024×768 and 1440×900. It asserts actual computed flex properties and geometry:
DOM/visual order, Home near the top, footer at the bottom, icon and label alignment, row
size, independent scrolling and lack of navigation/header overflow. It also exercises
close/backdrop/Escape, focus containment/return, reduced motion, all eight navigation links,
active routes, a nested farmer route, browser history, the existing logout handlers,
desktop collapse/persistence and resizing between desktop and mobile.

These are browser-rendered layout and UI interaction tests, not production authentication,
API authorization, physical-phone or Safari certification. Existing Node tests remain the
default `npm test` suite.
