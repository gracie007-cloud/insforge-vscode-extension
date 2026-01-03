import * as vscode from 'vscode';
import { AuthProvider } from './auth/authProvider';
import { ProjectTreeProvider } from './views/projectTreeProvider';
import { registerCommands } from './commands';

let authProvider: AuthProvider;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('InsForge extension is now active');

  // Initialize auth provider
  authProvider = new AuthProvider(context);

  // Initialize tree view provider
  const projectTreeProvider = new ProjectTreeProvider(authProvider);

  // Register tree view
  vscode.window.registerTreeDataProvider('insforge.projectView', projectTreeProvider);

  // Create status bar item (left side, high priority to be leftmost)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'insforge.selectProject';
  context.subscriptions.push(statusBarItem);

  // Update status bar when auth changes
  authProvider.onDidChangeAuth(() => {
    updateStatusBar();
  });

  // Register all commands
  registerCommands(context, authProvider, projectTreeProvider, updateStatusBar);

  // Check if user is already logged in
  const isLoggedIn = await authProvider.isAuthenticated();
  if (isLoggedIn) {
    vscode.commands.executeCommand('setContext', 'insforge.isLoggedIn', true);
    projectTreeProvider.refresh();
  }

  // Initial status bar update
  updateStatusBar();
}

function updateStatusBar() {
  const project = authProvider.getCurrentProject();

  if (project) {
    statusBarItem.text = `$(database) ${project.name}`;
    statusBarItem.tooltip = `InsForge: ${project.name} (${project.region}) - Connected`;
    statusBarItem.show();
  } else {
    statusBarItem.text = '$(database) InsForge';
    statusBarItem.tooltip = 'InsForge: No project selected';
    statusBarItem.show();
  }
}

export function deactivate() {
  console.log('InsForge extension is now deactivated');
}
