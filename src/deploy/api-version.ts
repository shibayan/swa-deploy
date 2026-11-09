/**
 * Default API runtime versions used when api-language is provided without
 * api-version. Keep this table and the README in sync with the supported
 * versions and end-of-support dates listed at
 * https://learn.microsoft.com/azure/static-web-apps/languages-runtimes#api
 */
const DEFAULT_API_VERSIONS: Readonly<Record<string, string>> = {
  // End of support: November 10, 2026
  dotnet: '8.0',
  dotnetisolated: '10.0',
  node: '22',
  python: '3.11'
}

export function getDefaultApiVersion(apiLanguage: string): string | undefined {
  const language = apiLanguage.toLowerCase()
  return Object.hasOwn(DEFAULT_API_VERSIONS, language)
    ? DEFAULT_API_VERSIONS[language]
    : undefined
}
