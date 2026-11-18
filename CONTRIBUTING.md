# Contributing

Use Node.js 24 or later and npm. Run `npm ci`, then `npm run check:partner`
for SDK tests, clean packed-package consumers, reference app tests, generated
schema checks, type checking and production build. These checks use synthetic
fixtures and mocked HTTP; no API key, Stripe account or live provider is needed.

The public OpenAPI snapshot is in `docs/partner-api-v1.openapi.yaml`. When the
published API contract changes, update that snapshot from Rainwalk's API source,
run `npm run generate:sdk`, and review compatibility before releasing. Do not
change the generated types alone.

Use `npm run test:release` for archive manifest and exclusion checks, and
`npm run verify:release` for a clean installation and complete checks of the
extracted ZIP. The latter installs locked npm dependencies in a temporary
directory and does not use configured sandbox credentials.

Submit focused pull requests with behavior, compatibility implications and
checks performed. Never include credentials or real customer data in source,
issues, logs, screenshots or examples. Use your Rainwalk contact for private
account/support questions rather than public GitHub issues.
