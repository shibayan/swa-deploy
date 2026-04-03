# swa-deploy

![Coverage](./badges/coverage.svg)

Deploy prebuilt frontend assets, Azure Functions APIs, and Static Web Apps Data
API configuration to Azure Static Web Apps from a GitHub Actions workflow.

This action follows the same deployment model as the Azure Static Web Apps CLI
`swa deploy` command. It resolves the app, output, API, and configuration paths,
downloads the current `StaticSitesClient` binary when needed, and uploads
content using a deployment token. On GitHub Actions runners, it also restores
and saves the `StaticSitesClient` cache automatically by using the GitHub
Actions cache service.

## What This Action Does

- Uploads already built frontend assets to Azure Static Web Apps
- Optionally uploads an Azure Functions API folder
- Supports preview or production deployments
- Restores and saves `~/.swa/deploy` automatically across workflow runs

This action does not build your app. It always deploys prebuilt output.

All relative paths are resolved from the current working directory.

## Inputs

| Name               | Required | Default      | Description                                                                  |
| ------------------ | -------- | ------------ | ---------------------------------------------------------------------------- |
| `app_location`     | No       | `.`          | Directory that contains the prebuilt frontend assets to deploy               |
| `api_location`     | No       |              | Directory that contains the Azure Functions API                              |
| `deployment_token` | No       |              | Deployment token. Falls back to `SWA_CLI_DEPLOYMENT_TOKEN`                   |
| `environment`      | No       | `production` | Target environment such as `preview` or `production`                         |
| `api_language`     | No       |              | API runtime language such as `node`, `python`, `dotnet`, or `dotnetisolated` |
| `api_version`      | No       |              | API runtime version                                                          |

## Outputs

| Name             | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `deployment_url` | URL reported by `StaticSitesClient` after a successful deployment, when available |

## Usage

### Deploy a built frontend

```yaml
name: deploy

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build app
        run: npm ci && npm run build

      - name: Deploy to Azure Static Web Apps
        id: deploy
        uses: shibayan/swa-deploy@v1
        with:
          app_location: dist
          environment: production
          deployment_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}

      - name: Print deployed URL
        run: echo "${{ steps.deploy.outputs.deployment_url }}"
```

### Deploy a frontend and API

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

`staticwebapp.config.json` is detected only from `app_location`.

## Built-in Caching

The action caches `StaticSitesClient` automatically on GitHub Actions runners,
similar to how `actions/setup-node` caches package manager data internally.

- Cache path: `~/.swa/deploy`
- Cache key: platform + `StaticSitesClient` build ID + checksum
- Restore timing: before deployment starts
- Save timing: in the action `post` step, even if the deployment step fails

No extra workflow configuration is required.

## Deployment Token

The action requires a deployment token.

You can get the token from:

1. Azure portal: Static Web App -> Overview -> Manage deployment token
1. Azure CLI:
   `az staticwebapp secrets list --name <app-name> --query "properties.apiKey"`

Store the token as a repository or environment secret and pass it through
`deployment_token`.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Bundle the action:

```bash
npm run bundle
```
