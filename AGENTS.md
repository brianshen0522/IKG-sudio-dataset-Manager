# Repository Guidelines

## Project Structure & Module Organization
This repository is a Next.js 14 application for managing YOLO datasets. UI pages and API routes live under `app/`; use `app/api/**/route.js` for server endpoints and `app/_components/` for shared client components. Reusable server-side logic, database helpers, workers, auth, and SSE utilities live in `src/lib/`. Static browser assets are in `public/`, documentation and screenshots are in `doc/`, and one-off maintenance scripts live in `scripts/` plus `duplicate_finder.py`.

## Build, Test, and Development Commands
- `npm install`: install app dependencies.
- `npm run dev`: start the local Next.js dev server on `MANAGER_PORT` or `3000`.
- `npm run build`: create a production build.
- `npm start`: run the production server from the built output.
- `docker compose up -d`: run the packaged stack defined by `compose.yml`.
- `docker compose -f compose.dev.example.yml up`: reference dev container workflow before creating a local `compose.dev.yml`.

## Coding Style & Naming Conventions
Use ES modules and keep the existing 2-space indentation style. Prefer `camelCase` for variables/functions, `PascalCase` for React components, and descriptive route folder names such as `app/api/datasets/[id]/jobs/[jobId]/`. Match the current repo style: semicolons enabled, single quotes in JavaScript, and CSS modules only where already established. There is no configured linter or formatter, so keep changes consistent with nearby files.

## Testing Guidelines
There is currently no automated test script or test directory in `package.json`. For changes, validate manually with `npm run dev`, exercise the affected page or API route, and verify database-backed flows against PostgreSQL when relevant. If you add tests, keep them close to the feature and name them after the unit under test, for example `manager-ui.test.js`.

## Commit & Pull Request Guidelines
Recent history uses Conventional Commit prefixes such as `feat:` and `fix:`. Keep commit subjects short, imperative, and scoped to one change. Pull requests should include a concise summary, note any environment or schema impact, link the related issue, and attach screenshots for UI changes affecting pages like `app/page.js` or the label editor.

## Security & Configuration Tips
Do not commit populated `.env` files, database dumps, or mounted dataset paths. Start from `.env.example`, keep `JWT_SECRET` strong, and use compose files only after confirming host dataset directories are mounted at the same absolute paths expected by the app.
