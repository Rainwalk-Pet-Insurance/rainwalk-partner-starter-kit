# Rainwalk Partner API v1 starter kit

Create your first sandbox quote, select a plan, and test a purchase with the
payment simulator. Includes the server-side TypeScript SDK, local reference app,
quickstart, and OpenAPI specification. Requires Node.js 24 or later and npm.
The SDK is included locally; no npm publication or repository access is required.

## Start locally

Clone this repository or extract a release ZIP, then open a terminal at its root:

```sh
npm ci
cp examples/partner-quickstart/.env.example examples/partner-quickstart/.env.local
```

In Windows PowerShell, replace the `cp` command with:

```powershell
Copy-Item examples/partner-quickstart/.env.example examples/partner-quickstart/.env.local
```

Create a **Sandbox** key in the [sandbox partner portal](https://dev.partners.rainwalk.io/portal/organization/api-keys/)
under **Organization → API keys**. Only sandbox organization owners can manage
keys; other developers should ask their owner to share a key through a secure
credential channel. Sandbox accounts are separate from production: a key created
in the production portal will not work with this app's sandbox API. Contact
Rainwalk if you need a sandbox invitation.

Edit `examples/partner-quickstart/.env.local` locally. Replace the placeholder
after `RAINWALK_API_KEY=` with your key. Never use a `NEXT_PUBLIC_` prefix or send
keys in chat, email, tickets, screenshots, or source control. The ZIP contains
only an example configuration, never a configured key.

```sh
npm run dev:partner
```

Open **http://127.0.0.1:3000** (or the port printed by Next.js). Wait for
**Sandbox connected**, load breeds for ZIP **78701**, choose a breed, and click
**Get sandbox quote**. Retrieve the saved quote, select its plan, and continue
with the default **Sandbox simulator**. Use synthetic data only.

The sandbox partner needs normal v1 rollout access and the capabilities listed
in the [full quickstart](examples/partner-quickstart/README.md). If access is
denied, contact Rainwalk with the environment, endpoint and request ID, never
your key.

## Test purchases

Choose successful, declined, pending-then-successful, or rejected-reference
scenarios. Approved references can be used to request sandbox binding with
synthetic recorded consent. Read the bind and policy results; a pending result
is not success. Keep the page open while an outcome is unknown: refresh loses
its in-memory retry context. Use a new quote for another completed purchase.

Successful simulator purchases create marked `SIM-` test policies, with
`test_policy` status and inactive simulated billing. There are no real funds or
insurance coverage. Simulation is blocked in production. Stripe requires
separate explicit Rainwalk approval, including in sandbox.

## Guides and checks

- [Reference app quickstart and troubleshooting](examples/partner-quickstart/README.md)
- [SDK usage](packages/partner-sdk/README.md)
- [Sandbox API reference](https://dev.api.rainwalk.io/api/schema/redoc/partner/v1)
- [OpenAPI specification](docs/partner-api-v1.openapi.yaml)

Run `npm run check:partner` for the included isolated tests, packed SDK consumer
checks, type checking, and app build. These checks need no API key and do not
make payment or email calls. No webhook receiver or persistent browser recovery
is included. Before hosting your own application, add authentication and other
backend controls described in the quickstart. Production and Stripe
certification are separate from this sandbox workflow.

This repository is the source of truth for the SDK and example. npm publication
is deferred; the root npm workspace builds the included SDK locally. See
[SDK usage](packages/partner-sdk/README.md), [contributing](CONTRIBUTING.md), and
[releasing](RELEASING.md). The code is available under the [MIT license](LICENSE).

`starter-kit-manifest.json` in each release ZIP lists the bundled source files and their SHA-256
hashes. A separate `.zip.sha256` file accompanies the portal download.
