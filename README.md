# Deploy Azure Static Web Apps

[![CI](https://github.com/shibayan/swa-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/shibayan/swa-deploy/actions/workflows/ci.yml)
![Coverage](./badges/coverage.svg)

A GitHub Action that deploys prebuilt frontend assets, Azure Functions APIs, and
`staticwebapp.config.json` to
[Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/).

It follows the same deployment model as `swa deploy` from the
[Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) —
download the `StaticSitesClient` binary, resolve paths, and upload content using
a deployment token. When `deployment-token` is omitted, this action can also
resolve the token at runtime through Azure Resource Manager after `azure/login`.
The binary is cached automatically across workflow runs.

> [!NOTE]
> This action **does not build** your application. Run your build step before
> calling this action.

## Usage

### Deploy a built frontend

```yaml
name: Deploy

on:
  push:
    branches: [master]

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
          app-location: dist
          deployment-token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}

      - run: echo "${{ steps.deploy.outputs.deployment-url }}"
```

### Deploy with an API

```yaml
- name: Deploy to Azure Static Web Apps
  uses: shibayan/swa-deploy@v1
  with:
    app-location: dist
    api-location: api
    api-language: node
    environment-name: preview
    deployment-token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
```

### Use azure/login instead of a deployment token

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Azure login
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy to Azure Static Web Apps
        uses: shibayan/swa-deploy@v1
        with:
          app-location: dist
          app-name: my-static-web-app
          resource-group-name: my-resource-group
```

## Inputs

| Name                  | Required | Default      | Description                                                                          |
| --------------------- | -------- | ------------ | ------------------------------------------------------------------------------------ |
| `app-location`        | No       | `.`          | Directory containing the prebuilt frontend assets                                    |
| `api-location`        | No       |              | Directory containing the Azure Functions API                                         |
| `deployment-token`    | No       |              | Deployment token (falls back to `SWA_CLI_DEPLOYMENT_TOKEN` env var)                  |
| `app-name`            | No       |              | Static Web App name used to resolve a deployment token from Azure Resource Manager   |
| `resource-group-name` | No       |              | Resource group name for `app-name`; when provided, skips subscription-wide discovery |
| `environment-name`    | No       | `production` | Target environment — `production`, `preview`, or a custom name                       |
| `api-language`        | No       |              | API runtime language: `node`, `python`, `dotnet`, or `dotnetisolated`                |
| `api-version`         | No       |              | API runtime version (defaults are `22` for Node, `3.11` for Python, `8.0` for .NET)  |

## Outputs

| Name             | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `deployment-url` | URL reported by `StaticSitesClient` after a successful deployment |

## License

This project is licensed under the [MIT License](LICENSE)
