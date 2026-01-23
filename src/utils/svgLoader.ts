import * as fs from 'fs';
import * as vscode from 'vscode';

/**
 * Load SVG file content as raw HTML string.
 * This allows SVGs to use currentColor and inherit CSS color properties.
 */
export function loadSvg(extensionUri: vscode.Uri, relativePath: string): string {
  const svgPath = vscode.Uri.joinPath(extensionUri, relativePath).fsPath;
  return fs.readFileSync(svgPath, 'utf8');
}

/**
 * Load multiple SVG files at once.
 * Returns an object with the file names (without extension) as keys.
 */
export function loadSvgs(
  extensionUri: vscode.Uri,
  basePath: string,
  fileNames: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fileName of fileNames) {
    const key = fileName.replace('.svg', '');
    result[key] = loadSvg(extensionUri, `${basePath}/${fileName}`);
  }
  return result;
}
