# InsForge VS Code Extension

Install and manage InsForge MCP servers with one click.

## Features

- OAuth login with InsForge
- Browse organizations and projects
- One-click MCP installation
- Manage installed MCP servers

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
npm install
npm run compile
```

### Testing

1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. A new VS Code window opens with the extension loaded
4. Look for "InsForge" in the Activity Bar (left sidebar)

### Commands

- `InsForge: Login` - Start OAuth flow
- `InsForge: Logout` - Clear session
- `InsForge: Select Project` - Pick org/project via QuickPick
- `InsForge: Install MCP` - Install MCP for selected project

## OAuth Setup

Before the extension works, you need to register it as an OAuth client in InsForge:

```bash
curl -X POST https://app.insforge.dev/api/oauth/v1/clients/register \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "InsForge VS Code Extension",
    "redirect_uris": ["vscode://insforge.insforge/callback"],
    "allowed_scopes": ["user:read", "organizations:read", "projects:read", "projects:write"],
    "client_type": "public"
  }'
```

Then update the `OAUTH_CLIENT_ID` in `src/auth/authProvider.ts`.

## Architecture

```
src/
├── extension.ts           # Entry point
├── auth/
│   └── authProvider.ts    # OAuth + PKCE flow
├── commands/
│   ├── index.ts           # Command registration
│   └── installMcp.ts      # MCP installation logic
└── views/
    ├── projectTreeProvider.ts   # Org/Project tree
    └── mcpTreeProvider.ts       # Installed MCPs tree
```

## Publishing

```bash
npx vsce package    # Creates .vsix file
npx vsce publish    # Publish to marketplace
```
