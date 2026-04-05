export function getDefaultApiVersion(apiLanguage: string): string | undefined {
  switch (apiLanguage.toLowerCase()) {
    case 'python':
      return '3.11'
    case 'dotnet':
    case 'dotnetisolated':
      return '8.0'
    case 'node':
      return '22'
    default:
      return undefined
  }
}
