# swa-deploy

[![CI](https://github.com/shibayan/swa-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/shibayan/swa-deploy/actions/workflows/ci.yml)
![Coverage](./badges/coverage.svg)

A GitHub Action that deploys prebuilt frontend assets, Azure Functions APIs, and
`staticwebapp.config.json` to
[Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/).

It follows the same deployment model as `swa deploy` from the
[Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) —
download the `StaticSitesClient` binary, resolve paths, and upload content using
a deployment token. The binary is cached automatically across workflow runs, so
no extra configuration is required.

> [!NOTE]
> This action **does not build** your application. It always deploys prebuilt
> output. Run your build step before calling this action.

## Features

- **Frontend deployment** — upload already-built assets to Azure Static Web Apps
- **API deployment** — optionally upload an Azure Functions API folder
- **Environment targeting** — deploy to `production` or any named preview
  environment
- **Automatic caching** — `StaticSitesClient` is cached and restored
  transparently via the GitHub Actions cache service
- **Config detection** — `staticwebapp.config.json` is picked up from
  `app_location` automatically

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `app_location` | No | `.` | Directory containing the prebuilt frontend assets |
| `api_location` | No | | Directory containing the Azure Functions API |
| `deployment_token` | No | | Deployment token (falls back to `SWA_CLI_DEPLOYMENT_TOKEN` env var) |
| `environment` | No | `production` | Target environment — `production`, `preview`, or a custom name |
| `api_language` | No | | API runtime language: `node`, `python`, `dotnet`, or `dotnetisolated` |
| `api_version` | No | | API runtime version (defaults are `22` for Node, `3.11` for Python, `8.0` for .NET) |

All paths are resolved relative to the current working directory.

## Outputs

| Name | Description |
| --- | --- |
| `deployment_url` | URL reported by `StaticSitesClient` after a successful deployment |

## Usage

### Deploy a built frontend

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Deploy to Azure Static Web Apps
        id: deploy
        uses: shibayan/swa-deploy@v1
        with:
          app_location: dist
          deployment_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}

      - run: echo "${{ steps.deploy.outputs.deployment_url }}"
```

### Deploy with an API

```yaml
- name: Deploy to Azure Static Web Apps
  uses: shibayan/swa-deploy@v1
  with:
    app_location: dist
    api_location: api
    api_language: node
    environment: preview
    deployment_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
```

### Use an environment variable instead of an input

```yaml
env:
  SWA_CLI_DEPLOYMENT_TOKEN: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}

steps:
  - name: Deploy to Azure Static Web Apps
    uses: shibayan/swa-deploy@v1
    with:
      app_location: dist
```

## Caching

`StaticSitesClient` is cached automatically on GitHub-hosted runners — no
workflow changes needed.

| Detail | Value |
| --- | --- |
| Cache path | `~/.swa/deploy` |
| Cache key | platform + build ID + binary checksum |
| Restore | before deployment |
| Save | in the `post` step (runs even if deployment fails) |

## Deployment Token

You can obtain a deployment token from:

- **Azure portal** — Static Web App → Overview → *Manage deployment token*
- **Azure CLI** —
  `az staticwebapp secrets list --name <app> --query "properties.apiKey" -o tsv`

Store the token as a
[repository or environment secret](https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
and pass it via `deployment_token`, or set the `SWA_CLI_DEPLOYMENT_TOKEN`
environment variable.

## Development

```bash
npm install     # install dependencies
npm test        # run tests
npm run bundle  # bundle the action into dist/
```

## License

[MIT](LICENSE)
