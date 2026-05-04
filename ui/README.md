# @arpanstacy/stacy-ui

Published static assets for the Stacy board UI.

## What gets published

The npm package contains the production build under `dist/`. It does not ship the UI source tree or workspace-only dependencies.

## Storybook

Storybook config, stories, and fixtures live under `ui/storybook/`.

```sh
pnpm --filter @arpanstacy/stacy-ui storybook
pnpm --filter @arpanstacy/stacy-ui build-storybook
```

## Typical use

Install the package, then serve or copy the built files from `node_modules/@arpanstacy/stacy-ui/dist`.
