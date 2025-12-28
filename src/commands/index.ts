import * as vscode from 'vscode';
import { AuthProvider } from '../auth/authProvider';
import { ProjectTreeProvider, ProjectItem } from '../views/projectTreeProvider';
import { McpTreeProvider } from '../views/mcpTreeProvider';
import { installMcp } from './installMcp';

export function registerCommands(
  context: vscode.ExtensionContext,
  authProvider: AuthProvider,
  projectTreeProvider: ProjectTreeProvider,
  mcpTreeProvider: McpTreeProvider
): void {
  // Login command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.login', async () => {
      await authProvider.login();
    })
  );

  // Logout command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.logout', async () => {
      await authProvider.logout();
      projectTreeProvider.refresh();
      mcpTreeProvider.refresh();
    })
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.refresh', () => {
      projectTreeProvider.refresh();
      mcpTreeProvider.refresh();
    })
  );

  // Select project via command palette
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.selectProject', async () => {
      const isLoggedIn = await authProvider.isAuthenticated();
      if (!isLoggedIn) {
        const login = await vscode.window.showInformationMessage(
          'Please login first',
          'Login'
        );
        if (login === 'Login') {
          await authProvider.login();
        }
        return;
      }

      // Get organizations
      const orgs = await authProvider.getOrganizations();
      if (orgs.length === 0) {
        vscode.window.showWarningMessage('No organizations found');
        return;
      }

      // Pick organization
      const orgPick = await vscode.window.showQuickPick(
        orgs.map((org) => ({
          label: org.name,
          description: org.slug,
          org,
        })),
        { placeHolder: 'Select an organization' }
      );

      if (!orgPick) {
        return;
      }

      // Get projects
      const projects = await authProvider.getProjects(orgPick.org.id);
      if (projects.length === 0) {
        vscode.window.showWarningMessage('No projects found in this organization');
        return;
      }

      // Pick project
      const projectPick = await vscode.window.showQuickPick(
        projects.map((project) => ({
          label: project.name,
          description: project.region,
          project,
        })),
        { placeHolder: 'Select a project' }
      );

      if (!projectPick) {
        return;
      }

      // Set current org and project
      authProvider.setCurrentOrg(orgPick.org);
      authProvider.setCurrentProject(projectPick.project);

      mcpTreeProvider.refresh();
      vscode.window.showInformationMessage(
        `Selected project: ${projectPick.project.name}`
      );
    })
  );

  // Select project from tree view
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.selectProjectItem', async (item: ProjectItem) => {
      authProvider.setCurrentOrg(item.organization);
      authProvider.setCurrentProject(item.project);

      mcpTreeProvider.refresh();
      vscode.window.showInformationMessage(
        `Selected project: ${item.project.name}`
      );
    })
  );

  // Install MCP command - can be called with a ProjectItem or use current project
  context.subscriptions.push(
    vscode.commands.registerCommand('insforge.installMcp', async (item?: ProjectItem) => {
      let project = item?.project || authProvider.getCurrentProject();

      // If called from tree view with a project item, use that project
      if (item instanceof ProjectItem) {
        project = item.project;
        // Also set it as current project
        authProvider.setCurrentOrg(item.organization);
        authProvider.setCurrentProject(item.project);
      }

      if (!project) {
        // No project selected - prompt user to select one
        const isLoggedIn = await authProvider.isAuthenticated();
        if (!isLoggedIn) {
          const login = await vscode.window.showInformationMessage(
            'Please login first to install MCP',
            'Login'
          );
          if (login === 'Login') {
            await authProvider.login();
          }
          return;
        }

        vscode.window.showWarningMessage('Please select a project first');
        return;
      }

      await installMcp(project, authProvider);
      mcpTreeProvider.refresh();
    })
  );
}
