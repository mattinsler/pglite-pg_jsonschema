export function generateControlFile(name: string, version: string, comment?: string): string {
  const lines = [
    `comment = '${comment ?? `${name} extension`}'`,
    `default_version = '${version}'`,
    `module_pathname = '$libdir/${name}'`,
    'relocatable = true',
  ];
  return lines.join('\n') + '\n';
}
