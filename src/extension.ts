import * as vscode from 'vscode';
import { AuthProvider } from './auth/authProvider';
import { ProjectTreeProvider } from './views/projectTreeProvider';
import { McpTreeProvider } from './views/mcpTreeProvider';
import { registerCommands } from './commands';

let authProvider: AuthProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('InsForge extension is now active');

  // Initialize auth provider
  authProvider = new AuthProvider(context);

  // Initialize tree view providers
  const projectTreeProvider = new ProjectTreeProvider(authProvider);
  const mcpTreeProvider = new McpTreeProvider(authProvider);

  // Register tree views
  vscode.window.registerTreeDataProvider('insforge.projectView', projectTreeProvider);
  vscode.window.registerTreeDataProvider('insforge.mcpView', mcpTreeProvider);

  // Register all commands
  registerCommands(context, authProvider, projectTreeProvider, mcpTreeProvider);

  // Check if user is already logged in
  const isLoggedIn = await authProvider.isAuthenticated();
  if (isLoggedIn) {
    vscode.commands.executeCommand('setContext', 'insforge.isLoggedIn', true);
    projectTreeProvider.refresh();
  }
}

export function deactivate() {
  console.log('InsForge extension is now deactivated');
}
