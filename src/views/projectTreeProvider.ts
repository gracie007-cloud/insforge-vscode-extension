import * as vscode from 'vscode';
import { AuthProvider, Organization, Project } from '../auth/authProvider';

type TreeItemType = OrganizationItem | ProjectItem | MessageItem;

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemType | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private authProvider: AuthProvider) {
    // Refresh when auth state changes
    authProvider.onDidChangeAuth(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItemType): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
    const isLoggedIn = await this.authProvider.isAuthenticated();

    if (!isLoggedIn) {
      return [new MessageItem('Click to login', 'insforge.login')];
    }

    if (!element) {
      // Root level - show organizations
      const orgs = await this.authProvider.getOrganizations();

      if (orgs.length === 0) {
        return [new MessageItem('No organizations found')];
      }

      return orgs.map((org) => new OrganizationItem(org));
    }

    if (element instanceof OrganizationItem) {
      // Show projects under organization
      const projects = await this.authProvider.getProjects(element.organization.id);

      if (projects.length === 0) {
        return [new MessageItem('No projects found')];
      }

      return projects.map((project) => new ProjectItem(project, element.organization));
    }

    return [];
  }
}

class OrganizationItem extends vscode.TreeItem {
  constructor(public readonly organization: Organization) {
    super(organization.name, vscode.TreeItemCollapsibleState.Expanded);

    this.contextValue = 'organization';
    this.iconPath = new vscode.ThemeIcon('organization');
    this.tooltip = `Organization: ${organization.name}`;
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly project: Project,
    public readonly organization: Organization
  ) {
    super(project.name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'project';
    this.iconPath = new vscode.ThemeIcon('server');
    this.tooltip = `Project: ${project.name}\nRegion: ${project.region}`;
    this.description = project.region;

    // Click to select this project
    this.command = {
      command: 'insforge.selectProjectItem',
      title: 'Select Project',
      arguments: [this],
    };
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(message: string, command?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'message';

    if (command) {
      this.command = {
        command,
        title: message,
      };
    }
  }
}

export { OrganizationItem, ProjectItem, MessageItem };
