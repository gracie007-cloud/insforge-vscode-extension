import * as vscode from 'vscode';
import { AuthProvider, Project } from '../auth/authProvider';

// Supported MCP clients from @insforge/install
const MCP_CLIENTS = [
  { id: 'cursor', label: 'Cursor', description: 'Cursor IDE (~/.cursor/mcp.json)', projectLocal: false },
  { id: 'claude-code', label: 'Claude Code', description: 'Project-local (.mcp.json in workspace)', projectLocal: true },
  { id: 'windsurf', label: 'Windsurf', description: 'Windsurf IDE (~/.codeium/windsurf/)', projectLocal: false },
  { id: 'cline', label: 'Cline', description: 'Cline VS Code Extension', projectLocal: false },
  { id: 'roocode', label: 'Roo Code', description: 'Roo-Code VS Code Extension', projectLocal: false },
  { id: 'copilot', label: 'GitHub Copilot', description: 'Project-local (.vscode/mcp.json)', projectLocal: true },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex CLI', projectLocal: false },
  { id: 'trae', label: 'Trae', description: 'Trae IDE', projectLocal: false },
  { id: 'qoder', label: 'Qoder', description: 'Qoder IDE', projectLocal: false },
] as const;

export async function installMcp(project: Project, authProvider: AuthProvider): Promise<boolean> {
  try {
    // Step 1: Let user pick which client to install for
    const clientPick = await vscode.window.showQuickPick(
      MCP_CLIENTS.map(client => ({
        label: client.label,
        description: client.description,
        id: client.id,
        projectLocal: client.projectLocal,
      })),
      {
        placeHolder: 'Select which AI client to install MCP for',
        title: 'Install InsForge MCP',
      }
    );

    if (!clientPick) {
      return false; // User cancelled
    }

    // Step 2: Get workspace folder for project-local clients
    let workspaceFolder: string | undefined;

    if (clientPick.projectLocal) {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          `${clientPick.label} requires an open workspace folder to install MCP config.`
        );
        return false;
      }

      if (workspaceFolders.length === 1) {
        workspaceFolder = workspaceFolders[0].uri.fsPath;
      } else {
        // Multiple workspaces - let user pick
        const folderPick = await vscode.window.showQuickPick(
          workspaceFolders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder: folder,
          })),
          {
            placeHolder: 'Select workspace folder to install MCP config',
            title: 'Select Workspace',
          }
        );

        if (!folderPick) {
          return false;
        }
        workspaceFolder = folderPick.folder.uri.fsPath;
      }

      // Confirm with user
      const confirm = await vscode.window.showInformationMessage(
        `Install InsForge MCP config to: ${workspaceFolder}?`,
        'Yes',
        'Cancel'
      );

      if (confirm !== 'Yes') {
        return false;
      }
    }

    // Step 3: Get API key for this project
    const apiKey = await authProvider.getProjectApiKey(project.id);
    if (!apiKey) {
      vscode.window.showErrorMessage('Could not retrieve API key for this project');
      return false;
    }

    // Step 4: Build the API base URL
    const apiBaseUrl = `https://${project.appkey}.${project.region}.insforge.app`;

    // Show progress while installing
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing InsForge MCP for ${clientPick.label}...`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: 'Preparing installation...' });

        // Build the MCP installer command
        const mcpCommand = buildMcpInstallerCommand(clientPick.id, apiKey, apiBaseUrl);

        progress.report({ increment: 30, message: 'Running MCP installer...' });

        // Create terminal with proper working directory
        const terminalOptions: vscode.TerminalOptions = {
          name: `InsForge MCP - ${clientPick.label}`,
          hideFromUser: false,
        };

        // Set cwd for project-local clients
        if (workspaceFolder) {
          terminalOptions.cwd = workspaceFolder;
        }

        const terminal = vscode.window.createTerminal(terminalOptions);

        terminal.show();
        terminal.sendText(mcpCommand);

        progress.report({ increment: 70, message: 'Finalizing...' });

        // Wait a bit for the command to start
        await new Promise((resolve) => setTimeout(resolve, 1500));

        progress.report({ increment: 100, message: 'Done!' });

        const location = workspaceFolder ? ` in ${workspaceFolder}` : '';
        vscode.window.showInformationMessage(
          `MCP installer started for ${clientPick.label}${location}. Check the terminal for progress.`,
          'Open Terminal'
        ).then(selection => {
          if (selection === 'Open Terminal') {
            terminal.show();
          }
        });

        return true;
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to install MCP: ${error}`);
    return false;
  }
}

function buildMcpInstallerCommand(client: string, apiKey: string, apiBaseUrl: string): string {
  // Using the @insforge/install package
  return `npx @insforge/install --client ${client} --env API_KEY=${apiKey} --env API_BASE_URL=${apiBaseUrl}`;
}
