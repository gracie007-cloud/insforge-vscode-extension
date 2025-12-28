import * as vscode from 'vscode';
import { AuthProvider } from '../auth/authProvider';

type TreeItemType = McpItem | MessageItem;

export class McpTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemType | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private authProvider: AuthProvider) {
    authProvider.onDidChangeAuth(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItemType): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
    if (element) {
      return [];
    }

    const currentProject = this.authProvider.getCurrentProject();

    if (!currentProject) {
      return [new MessageItem('Select a project first')];
    }

    // TODO: Check for installed MCPs in the workspace
    // For now, show a placeholder
    return [
      new McpItem(currentProject.name, currentProject.region, true),
    ];
  }
}

class McpItem extends vscode.TreeItem {
  constructor(
    public readonly projectName: string,
    public readonly region: string,
    public readonly isConnected: boolean
  ) {
    super(projectName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'mcp';
    this.iconPath = new vscode.ThemeIcon(isConnected ? 'check' : 'circle-outline');
    this.description = isConnected ? 'Connected' : 'Not connected';
    this.tooltip = `MCP for ${projectName} (${region})`;
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
  }
}

export { McpItem };
