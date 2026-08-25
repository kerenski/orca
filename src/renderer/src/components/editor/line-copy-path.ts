export function formatPathLineReference(filePath: string, line: number): string {
  return `${filePath}#L${line}`
}
