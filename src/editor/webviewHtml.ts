export interface WebviewHtmlOptions {
  readonly fileName: string;
  readonly scriptUri: string;
  readonly styleUri: string;
  readonly cspSource: string;
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const fileName = escapeHtml(options.fileName);
  const scriptUri = escapeHtml(options.scriptUri);
  const styleUri = escapeHtml(options.styleUri);
  const cspSource = escapeHtml(options.cspSource);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource}; img-src ${cspSource}; font-src ${cspSource}; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSVis — ${fileName}</title>
    <link rel="stylesheet" href="${styleUri}">
  </head>
  <body>
    <div id="root" role="status" aria-live="polite">Loading ${fileName}&hellip;</div>
    <script src="${scriptUri}" defer></script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
