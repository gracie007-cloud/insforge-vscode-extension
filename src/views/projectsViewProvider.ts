import * as vscode from 'vscode';
import { AuthProvider, Organization, Project } from '../auth/authProvider';
import { McpStatus } from '../commands/installMcp';
import { startMcpSocketListener, stopMcpSocketListener, stopAllMcpSocketListeners } from '../utils/mcpSocketListener';

const MCP_STATUS_KEY = 'insforge.mcpStatus';
const MCP_REAL_CONNECTED_KEY = 'insforge.mcpRealConnected';

interface McpProjectStatus {
  projectId: string;
  status: McpStatus;
  tools?: string[];
  error?: string;
  lastUpdated: number;
}

export class ProjectsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'insforge.projectsView';

  private _view?: vscode.WebviewView;
  private _context?: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _authProvider: AuthProvider
  ) {
    // Refresh when auth state changes
    this._disposables.push(_authProvider.onDidChangeAuth(() => this.refresh()));
    
    // Refresh when theme changes (to update logo)
    this._disposables.push(vscode.window.onDidChangeActiveColorTheme(() => this.refresh()));
  }

  /**
   * Set the extension context for state management
   */
  public setContext(context: vscode.ExtensionContext): void {
    this._context = context;
    context.subscriptions.push(...this._disposables);
  }

  /**
   * Get MCP status for all projects
   */
  private getMcpStatuses(): Map<string, McpProjectStatus> {
    if (!this._context) return new Map();
    const statuses = this._context.globalState.get<Record<string, McpProjectStatus>>(MCP_STATUS_KEY, {});
    return new Map(Object.entries(statuses));
  }

  /**
   * Get MCP status for a specific project
   */
  public getMcpStatus(projectId: string): McpStatus {
    const statuses = this.getMcpStatuses();
    return statuses.get(projectId)?.status || 'none';
  }

  /**
   * Get MCP tools for a verified project
   */
  public getMcpTools(projectId: string): string[] | undefined {
    const statuses = this.getMcpStatuses();
    return statuses.get(projectId)?.tools;
  }

  /**
   * Update MCP status for a project
   */
  private async updateMcpStatus(projectId: string, status: McpStatus, tools?: string[], error?: string): Promise<void> {
    if (!this._context) return;

    const statuses = this._context.globalState.get<Record<string, McpProjectStatus>>(MCP_STATUS_KEY, {});

    statuses[projectId] = {
      projectId,
      status,
      tools,
      error,
      lastUpdated: Date.now()
    };

    await this._context.globalState.update(MCP_STATUS_KEY, statuses);
    this.refresh();
  }

  /**
   * Clear other verified statuses for a project
   */
  private async clearOtherVerifiedStatuses(currentProjectId: string): Promise<void> {
    if (!this._context) return;

    const statuses = this._context.globalState.get<Record<string, McpProjectStatus>>(MCP_STATUS_KEY, {});

    for (const [id, status] of Object.entries(statuses)) {
      if (id !== currentProjectId && status.status === 'verified') {
        statuses[id] = { ...status, status: 'none', tools: undefined };
      }
    }

    await this._context.globalState.update(MCP_STATUS_KEY, statuses);
  }

  /**
   * Mark a project as verifying MCP (yellow dot)
   */
  public async markMcpVerifying(projectId: string): Promise<void> {
    await this.updateMcpStatus(projectId, 'verifying');
  }

  /**
   * Mark a project as having verified MCP (green dot)
   */
  public async markMcpVerified(projectId: string, tools: string[]): Promise<void> {
    await this.clearOtherVerifiedStatuses(projectId);
    await this.updateMcpStatus(projectId, 'verified', tools);
  }

  /**
   * Mark a project as having failed MCP verification (red dot)
   */
  public async markMcpFailed(projectId: string, error: string): Promise<void> {
    await this.updateMcpStatus(projectId, 'failed', undefined, error);
  }

  /**
   * Check if a project has MCP verified (for backward compatibility)
   */
  public isMcpInstalled(projectId: string): boolean {
    return this.getMcpStatus(projectId) === 'verified';
  }

  /**
   * Get the project ID that currently has MCP installed (for backward compatibility)
   */
  public getInstalledMcpProject(): string | null {
    const statuses = this.getMcpStatuses();
    for (const [projectId, status] of statuses) {
      if (status.status === 'verified') {
        return projectId;
      }
    }
    return null;
  }

  /**
   * Check if MCP is real connected (confirmed by socket event)
   */
  public isMcpRealConnected(): boolean {
    if (!this._context) return false;
    return this._context.globalState.get<boolean>(MCP_REAL_CONNECTED_KEY, false);
  }

  /**
   * Mark MCP as real connected (received socket confirmation)
   */
  public async markMcpRealConnected(): Promise<void> {
    if (!this._context) return;
    await this._context.globalState.update(MCP_REAL_CONNECTED_KEY, true);

    // Send message to webview to show completion and auto-hide
    if (this._view) {
      this._view.webview.postMessage({ command: 'showCompletion' });
    }

    this.refresh();
  }

  /**
   * Start listening for MCP connected events via socket
   */
  public async startSocketListener(project: Project, apiKey: string): Promise<void> {
    const apiBaseUrl = `https://${project.appkey}.${project.region}.insforge.app`;

    startMcpSocketListener(
      project.id,
      apiKey,
      apiBaseUrl,
      {
        onConnected: () => {
          console.log(`[ProjectsViewProvider] Socket connected for project ${project.id}`);
        },
        onMcpEvent: async (event) => {
          console.log(`[ProjectsViewProvider] MCP event received:`, event);
          vscode.window.showInformationMessage(
            `MCP Connected! Tool "${event.tool_name}" was called by your coding agent.`
          );
          await this.markMcpRealConnected();
        },
        onDisconnected: () => {
          console.log(`[ProjectsViewProvider] Socket disconnected for project ${project.id}`);
        },
        onError: (error) => {
          console.error(`[ProjectsViewProvider] Socket error:`, error);
        }
      }
    );
  }

  /**
   * Stop socket listener for a project
   */
  public stopSocketListener(projectId: string): void {
    stopMcpSocketListener(projectId);
  }

  /**
   * Stop all socket listeners (called on deactivate)
   */
  public stopAllSocketListeners(): void {
    stopAllMcpSocketListeners();
  }

  /**
   * Clear all extension state (for testing)
   */
  public async clearAllState(): Promise<void> {
    if (!this._context) return;
    this.stopAllSocketListeners();
    await this._context.globalState.update(MCP_STATUS_KEY, undefined);
    await this._context.globalState.update(MCP_REAL_CONNECTED_KEY, undefined);
    this.refresh();
  }

  public refresh(): void {
    if (this._view) {
      this._updateContent();
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    this._updateContent();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'login':
          vscode.commands.executeCommand('insforge.login');
          break;
        case 'selectProject':
          await this._handleSelectProject(message.orgId, message.projectId);
          break;
        case 'createProject':
          const createUrl = `https://insforge.dev/dashboard/organization/${message.orgId}/projects?newProject=true`;
          vscode.env.openExternal(vscode.Uri.parse(createUrl));
          break;
        case 'installMcp':
          await this._handleInstallMcp(message.orgId, message.projectId);
          break;
        case 'openInInsforge':
          const openUrl = `https://insforge.dev/dashboard/organization/${message.orgId}/projects`;
          vscode.env.openExternal(vscode.Uri.parse(openUrl));
          break;
        case 'viewProjectDetails':
          const projectUrl = `https://insforge.dev/dashboard/project/${message.projectId}`;
          vscode.env.openExternal(vscode.Uri.parse(projectUrl));
          break;
        case 'retryMcpVerification':
          await this._handleRetryMcpVerification(message.orgId, message.projectId);
          break;
        case 'refresh':
          this.refresh();
          break;
      }
    });
  }

  private async _handleSelectProject(orgId: string, projectId: string): Promise<void> {
    const orgs = await this._authProvider.getOrganizations();
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    const projects = await this._authProvider.getProjects(orgId);
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    this._authProvider.setCurrentOrg(org);
    this._authProvider.setCurrentProject(project);

    vscode.window.showInformationMessage(`Selected project: ${project.name}`);
  }

  private async _handleInstallMcp(orgId: string, projectId: string): Promise<void> {
    const orgs = await this._authProvider.getOrganizations();
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    const projects = await this._authProvider.getProjects(orgId);
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Set current org and project
    this._authProvider.setCurrentOrg(org);
    this._authProvider.setCurrentProject(project);

    // Execute install MCP command
    vscode.commands.executeCommand('insforge.installMcp');
  }

  private async _handleRetryMcpVerification(orgId: string, projectId: string): Promise<void> {
    const projects = await this._authProvider.getProjects(orgId);
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Get API credentials
    const apiKey = await this._authProvider.getProjectApiKey(projectId);
    if (!apiKey) {
      vscode.window.showErrorMessage('Could not retrieve API key for verification');
      return;
    }

    const apiBaseUrl = `https://${project.appkey}.${project.region}.insforge.app`;

    // Import and call retry verification
    const { retryVerification } = await import('../commands/installMcp');
    await retryVerification(
      projectId,
      apiKey,
      apiBaseUrl,
      {
        onVerifying: (pid) => this.markMcpVerifying(pid),
        onVerified: (pid, tools) => this.markMcpVerified(pid, tools),
        onFailed: (pid, error) => this.markMcpFailed(pid, error),
      }
    );
  }

  private async _updateContent(): Promise<void> {
    if (!this._view) return;

    const isLoggedIn = await this._authProvider.isAuthenticated();

    if (!isLoggedIn) {
      this._view.webview.html = this._getWelcomeHtml(this._view.webview);
      return;
    }

    const orgs = await this._authProvider.getOrganizations();
    const orgsWithProjects: Array<{ org: Organization; projects: Project[] }> = [];

    for (const org of orgs) {
      const projects = await this._authProvider.getProjects(org.id);
      orgsWithProjects.push({ org, projects });
    }

    this._view.webview.html = this._getProjectsHtml(this._view.webview, orgsWithProjects);
  }

  private _getWelcomeHtml(webview: vscode.Webview): string {
    // Choose logo based on current theme
    const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
      || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    const logoFile = isDarkTheme ? 'logo-dark.svg' : 'logo-light.svg';
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', logoFile)
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this._getStyles()}
</head>
<body>
  <div class="welcome-container">
    <img class="logo" src="${logoUri}" alt="InsForge Logo" />
    <p class="welcome-text">
      Install and manage MCP servers with one click.<br/>
      Power AI coding assistants across IDEs.
    </p>
    <button class="btn primary" onclick="login()">Log in to InsForge</button>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    function login() {
      vscode.postMessage({ command: 'login' });
    }
  </script>
</body>
</html>`;
  }

  private _getProjectsHtml(
    webview: vscode.Webview,
    orgsWithProjects: Array<{ org: Organization; projects: Project[] }>
  ): string {
    // All icons are now inline SVGs for better theming support

    const orgsHtml = orgsWithProjects.map(({ org, projects }) => {
      if (projects.length === 0) {
        // Empty state for org with no projects
        return `
          <div class="org-section">
            <div class="org-header" onclick="toggleOrg('${org.id}')">
              <span class="codicon codicon-chevron-down" id="chevron-${org.id}"></span>
              <span class="codicon codicon-organization"></span>
              <span class="org-name" title="${this._escapeHtml(org.name)}">${this._escapeHtml(org.name)}</span>
              <button class="org-open-btn" onclick="event.stopPropagation(); openInInsforge('${org.id}')" title="Open in InsForge">
                Open in InsForge
                <span class="codicon codicon-link-external"></span>
              </button>
            </div>
            <div class="org-content" id="content-${org.id}">
              <div class="empty-state">
                <svg class="folder-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M33.333 33.3333C34.2171 33.3333 35.0649 32.9821 35.69 32.357C36.3152 31.7319 36.6663 30.8841 36.6663 30V13.3333C36.6663 12.4493 36.3152 11.6014 35.69 10.9763C35.0649 10.3512 34.2171 10 33.333 10H20.1663C19.6089 10.0055 19.0589 9.87102 18.5668 9.60897C18.0748 9.34691 17.6563 8.96563 17.3497 8.5L15.9997 6.5C15.6962 6.03912 15.283 5.6608 14.7972 5.39899C14.3114 5.13719 13.7682 5.00009 13.2163 5H6.66634C5.78229 5 4.93444 5.35119 4.30932 5.97631C3.6842 6.60143 3.33301 7.44928 3.33301 8.33333V30C3.33301 30.8841 3.6842 31.7319 4.30932 32.357C4.93444 32.9821 5.78229 33.3333 6.66634 33.3333H33.333Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <p class="empty-title">No Projects Yet</p>
                <p class="empty-desc">Add your first project to get started</p>
                <button class="btn primary" onclick="createProject('${org.id}')">Create First Project</button>
              </div>
            </div>
          </div>
        `;
      }

      // Org with projects
      const projectsHtml = projects.map(project => {
        const statusText = project.status || 'Unknown';
        const locationText = project.region || 'Unknown';
        const databaseSize = project.storage_disk_size ? `${project.storage_disk_size} GB` : 'Unknown';
        const mcpStatus = this.getMcpStatus(project.id);
        const mcpTools = this.getMcpTools(project.id);
        const toolCount = mcpTools?.length || 0;

        // Show different UI based on MCP status
        let mcpStatusHtml: string;
        switch (mcpStatus) {
          case 'verifying':
            mcpStatusHtml = `<span class="mcp-verifying-dot" title="Verifying MCP server..."></span>`;
            break;
          case 'verified':
            mcpStatusHtml = `<span class="mcp-verified-dot" title="MCP Server Verified (${toolCount} tools)"></span>`;
            break;
          case 'failed':
            mcpStatusHtml = `<button
              class="mcp-failed-btn"
              title="MCP verification failed - Click to retry"
              aria-label="Retry MCP verification"
              onclick="event.stopPropagation(); retryMcpVerification('${org.id}', '${project.id}')"
            >
              <span class="mcp-failed-dot"></span>
            </button>`;
            break;
          default:
            mcpStatusHtml = `<button class="install-btn" onclick="event.stopPropagation(); installMcp('${org.id}', '${project.id}')" title="Install MCP">
              <svg class="mcp-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.70233 2.18782L12.6317 4.45649C12.8451 4.57977 13.0223 4.75704 13.1455 4.97048C13.2687 5.18392 13.3336 5.42603 13.3337 5.67249V10.2092C13.3337 10.7112 13.0657 11.1745 12.6317 11.4258L8.70233 13.6938C8.48887 13.817 8.24677 13.8818 8.00033 13.8818C7.75389 13.8818 7.51178 13.817 7.29833 13.6938L3.36899 11.4265C3.15539 11.3031 2.97806 11.1256 2.85482 10.9119C2.73159 10.6982 2.66681 10.4558 2.66699 10.2092V5.67315C2.66699 5.17182 2.93499 4.70782 3.36899 4.45715L7.29833 2.18849C7.51178 2.06532 7.75389 2.00049 8.00033 2.00049C8.24677 2.00049 8.48887 2.06532 8.70233 2.18849V2.18782ZM7.76699 2.99982L4.26033 5.02249L5.71566 5.84182L5.18366 6.78715L3.60299 5.89782V10.2092C3.60299 10.3765 3.69233 10.5312 3.83766 10.6145L7.48299 12.7192V10.5165H8.56766L8.56699 12.6905L12.163 10.6145C12.2343 10.5735 12.2935 10.5144 12.3347 10.4433C12.3759 10.3721 12.3976 10.2914 12.3977 10.2092L12.397 5.92582L10.867 6.78715L10.335 5.84182L11.7643 5.03715L8.23433 2.99915C8.16318 2.95808 8.08248 2.93645 8.00033 2.93645C7.91818 2.93645 7.83747 2.95808 7.76633 2.99915L7.76699 2.99982ZM8.83366 6.99982V7.66649H8.50033C8.32353 7.66651 8.15399 7.73676 8.02899 7.86178C7.90399 7.98681 7.83376 8.15636 7.83376 8.33315C7.83376 8.50995 7.90399 8.6795 8.02899 8.80452C8.15399 8.92954 8.32353 8.99979 8.50033 8.99982H8.83366V9.66649H8.50033C8.1467 9.66649 7.80757 9.52601 7.55752 9.27596C7.30747 9.02591 7.16699 8.68677 7.16699 8.33315C7.16699 7.97953 7.30747 7.64039 7.55752 7.39034C7.80757 7.1403 8.1467 6.99982 8.50033 6.99982H8.83366ZM10.8337 6.99982C11.0989 6.99982 11.3532 7.10518 11.5408 7.29271C11.7283 7.48025 11.8337 7.7346 11.8337 7.99982C11.8337 8.26504 11.7283 8.51939 11.5408 8.70693C11.3532 8.89446 11.0989 8.99982 10.8337 8.99982H10.167V9.66649H9.50033V7.49982C9.50033 7.36721 9.553 7.24003 9.64677 7.14627C9.74054 7.0525 9.86772 6.99982 10.0003 6.99982H10.8337ZM6.83366 7.33315V9.66649H6.16699V8.53582L5.78633 9.17115C5.75939 9.21616 5.72222 9.25417 5.67783 9.28211C5.63344 9.31004 5.58308 9.3271 5.53085 9.33191C5.47862 9.33672 5.426 9.32913 5.37725 9.30977C5.32851 9.29041 5.28502 9.25982 5.25033 9.22049L5.21433 9.17115L4.83366 8.53649V9.66649H4.16699V7.33315C4.16699 6.99515 4.61233 6.87182 4.78633 7.16182L5.50033 8.35182L6.21433 7.16182C6.38833 6.87182 6.83366 6.99515 6.83366 7.33315ZM10.8337 7.66649H10.167V8.33315H10.8337C10.9221 8.33315 11.0069 8.29803 11.0694 8.23552C11.1319 8.17301 11.167 8.08822 11.167 7.99982C11.167 7.91141 11.1319 7.82663 11.0694 7.76412C11.0069 7.70161 10.9221 7.66649 10.8337 7.66649Z" fill="currentColor"/>
              </svg>
              <span class="install-text">Install MCP</span>
            </button>`;
        }

        return `
        <div class="project-section">
          <div class="project-header" onclick="toggleProject('${project.id}')">
            <span class="codicon codicon-chevron-right" id="project-chevron-${project.id}"></span>
            <span class="codicon codicon-project"></span>
            <span class="project-name" title="${this._escapeHtml(project.name)}">${this._escapeHtml(project.name)}</span>
            ${mcpStatusHtml}
          </div>
          <div class="project-content collapsed" id="project-content-${project.id}">
            <div class="project-details">
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value">${this._escapeHtml(statusText)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Location</span>
                <span class="detail-value">${this._escapeHtml(locationText)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Database</span>
                <span class="detail-value">${this._escapeHtml(databaseSize)}</span>
              </div>
              <a class="view-details-link" href="#" onclick="event.preventDefault(); viewProjectDetails('${project.id}')">
                View Details in InsForge
                <span class="codicon codicon-chevron-right"></span>
              </a>
            </div>
          </div>
        </div>
      `;
      }).join('');

      return `
        <div class="org-section">
          <div class="org-header" onclick="toggleOrg('${org.id}')">
            <span class="codicon codicon-chevron-down" id="chevron-${org.id}"></span>
            <span class="codicon codicon-organization"></span>
            <span class="org-name" title="${this._escapeHtml(org.name)}">${this._escapeHtml(org.name)}</span>
            <button class="org-open-btn" onclick="event.stopPropagation(); openInInsforge('${org.id}')" title="Open in InsForge">
              Open in InsForge
              <span class="codicon codicon-link-external"></span>
            </button>
          </div>
          <div class="org-content" id="content-${org.id}">
            ${projectsHtml}
          </div>
        </div>
      `;
    }).join('');

    const hasMcpInstalled = this.getInstalledMcpProject() !== null;
    const hasMcpRealConnected = this.isMcpRealConnected();

    // Determine which step to show:
    // - step1: No MCP installed yet
    // - step2: MCP installed but not real connected (waiting for socket confirmation)
    // - stepComplete: Real connected (socket confirmed)
    const showStep1 = !hasMcpInstalled;
    const showStep2 = hasMcpInstalled && !hasMcpRealConnected;
    const showComplete = hasMcpRealConnected;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/@vscode/codicons/dist/codicon.css">
  ${this._getStyles()}
</head>
<body>
  <div class="projects-container">
    ${orgsHtml.length > 0 ? orgsHtml : '<p class="no-orgs">No organizations found</p>'}
  </div>
  
  <!-- MCP Setup Guide -->
  <div class="guide-wrapper" id="guideWrapper">
    <div class="guide-card" id="guideCard">
      <!-- Step 1: Install MCP -->
      <div class="guide-step ${showStep1 ? '' : 'hidden'}" id="step1">
        <div class="guide-content">
          <div class="guide-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.9338 14.9233C16.8674 14.8568 16.7886 14.8042 16.7019 14.7682C16.6152 14.7323 16.5223 14.7138 16.4284 14.7138C16.3346 14.7138 16.2416 14.7323 16.1549 14.7682C16.0682 14.8042 15.9894 14.8568 15.9231 14.9233L14.2857 16.5616L12.4384 14.7143L14.0767 13.0769C14.2108 12.9429 14.2861 12.7611 14.2861 12.5716C14.2861 12.382 14.2108 12.2003 14.0767 12.0662C13.9427 11.9322 13.761 11.8569 13.5714 11.8569C13.3819 11.8569 13.2001 11.9322 13.0661 12.0662L11.4287 13.7046L9.79124 12.0662C9.65722 11.9322 9.47544 11.8569 9.28591 11.8569C9.09637 11.8569 8.9146 11.9322 8.78057 12.0662C8.64655 12.2003 8.57126 12.382 8.57126 12.5716C8.57126 12.7611 8.64655 12.9429 8.78057 13.0769L9.34751 13.643L7.26547 15.7241C7.0001 15.9894 6.7896 16.3044 6.64598 16.6511C6.50236 16.9977 6.42844 17.3693 6.42844 17.7445C6.42844 18.1198 6.50236 18.4914 6.64598 18.838C6.7896 19.1847 7.0001 19.4997 7.26547 19.765L7.7458 20.2444L5.20932 22.78C5.14295 22.8464 5.09031 22.9252 5.0544 23.0119C5.01848 23.0986 5 23.1915 5 23.2854C5 23.3792 5.01848 23.4721 5.0544 23.5588C5.09031 23.6455 5.14295 23.7243 5.20932 23.7907C5.34334 23.9247 5.52511 24 5.71465 24C5.8085 24 5.90143 23.9815 5.98813 23.9456C6.07484 23.9097 6.15362 23.857 6.21998 23.7907L8.75557 21.2542L9.23502 21.7345C9.50032 21.9999 9.8153 22.2104 10.162 22.354C10.5086 22.4976 10.8802 22.5716 11.2555 22.5716C11.6307 22.5716 12.0023 22.4976 12.3489 22.354C12.6956 22.2104 13.0106 21.9999 13.2759 21.7345L15.357 19.6525L15.9231 20.2194C15.9894 20.2858 16.0682 20.3384 16.1549 20.3743C16.2416 20.4103 16.3346 20.4287 16.4284 20.4287C16.5223 20.4287 16.6152 20.4103 16.7019 20.3743C16.7886 20.3384 16.8674 20.2858 16.9338 20.2194C17.0001 20.1531 17.0528 20.0743 17.0887 19.9876C17.1246 19.9009 17.1431 19.8079 17.1431 19.7141C17.1431 19.6202 17.1246 19.5273 17.0887 19.4406C17.0528 19.3539 17.0001 19.2751 16.9338 19.2088L15.2954 17.5713L16.9338 15.9339C17.0002 15.8676 17.0528 15.7888 17.0888 15.7021C17.1247 15.6154 17.1432 15.5224 17.1432 15.4286C17.1432 15.3347 17.1247 15.2418 17.0888 15.1551C17.0528 15.0684 17.0002 14.9896 16.9338 14.9233ZM12.2652 20.7265C11.9974 20.9942 11.6342 21.1446 11.2555 21.1446C10.8768 21.1446 10.5136 20.9942 10.2457 20.7265L8.27613 18.7543C8.00844 18.4864 7.85807 18.1232 7.85807 17.7445C7.85807 17.3658 8.00844 17.0026 8.27613 16.7348L10.3573 14.6527L14.3473 18.6427L12.2652 20.7265ZM24.7905 4.20948C24.7242 4.14307 24.6454 4.09039 24.5587 4.05445C24.472 4.0185 24.3791 4 24.2852 4C24.1913 4 24.0984 4.0185 24.0117 4.05445C23.925 4.09039 23.8462 4.14307 23.7799 4.20948L21.2443 6.74597L20.7648 6.26563C20.2284 5.73079 19.5019 5.43045 18.7444 5.43045C17.9869 5.43045 17.2603 5.73079 16.7239 6.26563L14.6428 8.34768L14.0767 7.78074C13.9427 7.64672 13.761 7.57142 13.5714 7.57142C13.3819 7.57142 13.2001 7.64672 13.0661 7.78074C12.9321 7.91476 12.8568 8.09653 12.8568 8.28607C12.8568 8.47561 12.9321 8.65738 13.0661 8.7914L20.2086 15.9339C20.275 16.0003 20.3537 16.0529 20.4404 16.0888C20.5272 16.1247 20.6201 16.1432 20.7139 16.1432C20.8078 16.1432 20.9007 16.1247 20.9874 16.0888C21.0741 16.0529 21.1529 16.0003 21.2193 15.9339C21.2856 15.8676 21.3383 15.7888 21.3742 15.7021C21.4101 15.6154 21.4286 15.5224 21.4286 15.4286C21.4286 15.3347 21.4101 15.2418 21.3742 15.1551C21.3383 15.0684 21.2856 14.9896 21.2193 14.9233L20.6523 14.3572L22.7344 12.2761C22.9997 12.0108 23.2102 11.6958 23.3539 11.3491C23.4975 11.0024 23.5714 10.6309 23.5714 10.2556C23.5714 9.88038 23.4975 9.50881 23.3539 9.16214C23.2102 8.81547 22.9997 8.50049 22.7344 8.23518L22.254 7.75574L24.7905 5.22015C24.8569 5.15381 24.9096 5.07504 24.9456 4.98833C24.9815 4.90162 25 4.80868 25 4.71481C25 4.62095 24.9815 4.52801 24.9456 4.4413C24.9096 4.35459 24.8569 4.27582 24.7905 4.20948ZM21.7237 11.2627L19.6426 13.3474L15.6526 9.35745L17.7346 7.2763C18.0025 7.0086 18.3657 6.85823 18.7444 6.85823C19.1231 6.85823 19.4863 7.0086 19.7542 7.2763L21.7237 9.24049C21.8571 9.37322 21.9629 9.53099 22.0351 9.70474C22.1073 9.87849 22.1445 10.0648 22.1445 10.2529C22.1445 10.4411 22.1073 10.6274 22.0351 10.8011C21.9629 10.9749 21.8571 11.1327 21.7237 11.2654V11.2627Z" fill="currentColor"/>
            </svg>
          </div>
          <div class="guide-text">
            <div class="guide-title">Install a new MCP Server</div>
            <div class="guide-desc">Pick a project and connect it to your IDE to get started.</div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
        <div class="guide-footer">
          <span class="guide-step-indicator">1 / 2</span>
          <div class="guide-nav">
            <button class="guide-nav-btn" disabled>
              <span class="codicon codicon-chevron-left"></span>
            </button>
            <button class="guide-nav-btn" onclick="goToStep(2)">
              <span class="codicon codicon-chevron-right"></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Step 2: Verify Connection -->
      <div class="guide-step ${showStep2 ? '' : 'hidden'}" id="step2">
        <div class="guide-content">
          <div class="guide-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24.5667 4.43899C24.378 4.25049 24.1425 4.11569 23.8844 4.04846C23.6263 3.98122 23.3549 3.984 23.0982 4.0565H23.0841L5.0849 9.51643C4.79269 9.60062 4.53297 9.77159 4.34016 10.0067C4.14734 10.2418 4.03053 10.5299 4.00521 10.8328C3.97989 11.1358 4.04725 11.4393 4.19837 11.7031C4.34948 11.967 4.57722 12.1786 4.8514 12.3101L12.8148 16.1876L16.6877 24.1441C16.8082 24.401 16.9997 24.6182 17.2396 24.7699C17.4796 24.9215 17.7579 25.0014 18.0418 25C18.085 25 18.1281 24.9981 18.1712 24.9944C18.474 24.9698 18.7621 24.8533 18.9968 24.6605C19.2314 24.4676 19.4015 24.2076 19.4841 23.9153L24.9418 5.92116C24.9418 5.91648 24.9418 5.91179 24.9418 5.9071C25.0153 5.65113 25.0192 5.38023 24.9533 5.12222C24.8874 4.8642 24.754 4.62839 24.5667 4.43899ZM18.0503 23.4859L18.0456 23.4991V23.4925L14.2889 15.777L18.7902 11.277C18.9249 11.1352 18.9989 10.9464 18.9964 10.7509C18.9939 10.5553 18.9151 10.3684 18.7768 10.2301C18.6384 10.0918 18.4515 10.013 18.2559 10.0105C18.0603 10.008 17.8714 10.082 17.7296 10.2167L13.2283 14.7167L5.50783 10.9611H5.50127H5.51439L23.5052 5.50023L18.0503 23.4859Z" fill="currentColor"/>
            </svg>
          </div>
          <div class="guide-text">
            <div class="guide-title">Verify Connection</div>
            <div class="guide-desc">Send the prompt below to your AI coding agent to verify the connection.</div>
            <div class="guide-prompt-box">
              <span class="prompt-label">prompt</span>
              <button class="prompt-copy" onclick="copyPrompt()" title="Copy">
                <svg class="copy-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <g clip-path="url(#clip0_copy)">
                    <path d="M13.9997 7.3335C13.9997 6.96531 13.7012 6.66683 13.333 6.66683H7.33301C6.96482 6.66683 6.66634 6.96531 6.66634 7.3335V13.3335C6.66634 13.7017 6.96482 14.0002 7.33301 14.0002H13.333C13.7012 14.0002 13.9997 13.7017 13.9997 13.3335V7.3335ZM15.333 13.3335C15.333 14.4381 14.4376 15.3335 13.333 15.3335H7.33301C6.22844 15.3335 5.33301 14.4381 5.33301 13.3335V7.3335C5.33301 6.22893 6.22844 5.3335 7.33301 5.3335H13.333C14.4376 5.3335 15.333 6.22893 15.333 7.3335V13.3335Z" fill="currentColor"/>
                    <path d="M9.33366 3.33317V2.6665C9.33366 2.48969 9.26337 2.32017 9.13835 2.19515C9.01332 2.07013 8.8438 1.99984 8.66699 1.99984H2.66699C2.49018 1.99984 2.32066 2.07013 2.19564 2.19515C2.07061 2.32017 2.00033 2.48969 2.00033 2.6665V8.6665C2.00033 8.84332 2.07061 9.01283 2.19564 9.13786C2.32066 9.26288 2.49018 9.33317 2.66699 9.33317H3.33366C3.70185 9.33317 4.00033 9.63165 4.00033 9.99984C4.00033 10.368 3.70185 10.6665 3.33366 10.6665H2.66699C2.13656 10.6665 1.628 10.4556 1.25293 10.0806C0.877857 9.70549 0.666992 9.19694 0.666992 8.6665V2.6665C0.666992 2.13607 0.877857 1.62751 1.25293 1.25244C1.628 0.877369 2.13656 0.666504 2.66699 0.666504H8.66699C9.19743 0.666504 9.70598 0.877369 10.0811 1.25244C10.4561 1.62751 10.667 2.13607 10.667 2.6665V3.33317C10.667 3.70136 10.3685 3.99984 10.0003 3.99984C9.63214 3.99984 9.33366 3.70136 9.33366 3.33317Z" fill="currentColor"/>
                  </g>
                  <defs><clipPath id="clip0_copy"><rect width="16" height="16" fill="white"/></clipPath></defs>
                </svg>
              </button>
              <p class="prompt-text">I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.</p>
            </div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
        <div class="guide-footer">
          <span class="guide-step-indicator">2 / 2</span>
          <div class="guide-nav">
            <button class="guide-nav-btn" onclick="goToStep(1)">
              <span class="codicon codicon-chevron-left"></span>
            </button>
            <button class="guide-nav-btn" disabled>
              <span class="codicon codicon-chevron-right"></span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Completion: Connection Verified -->
      <div class="guide-step ${showComplete ? '' : 'hidden'}" id="stepComplete">
        <div class="guide-content">
          <div class="guide-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2.625C11.7502 2.625 9.551 3.29213 7.68039 4.54203C5.80978 5.79193 4.35182 7.56847 3.49088 9.64698C2.62993 11.7255 2.40467 14.0126 2.84357 16.2192C3.28248 18.4257 4.36584 20.4525 5.95667 22.0433C7.54749 23.6342 9.57432 24.7175 11.7809 25.1564C13.9874 25.5953 16.2745 25.3701 18.353 24.5091C20.4315 23.6482 22.2081 22.1902 23.458 20.3196C24.7079 18.449 25.375 16.2498 25.375 14C25.3718 10.9841 24.1724 8.09271 22.0398 5.96018C19.9073 3.82764 17.0159 2.62818 14 2.625ZM18.9941 11.9941L12.8691 18.1191C12.7878 18.2004 12.6913 18.265 12.5851 18.309C12.4789 18.353 12.365 18.3757 12.25 18.3757C12.135 18.3757 12.0212 18.353 11.9149 18.309C11.8087 18.265 11.7122 18.2004 11.6309 18.1191L9.00594 15.4941C8.84176 15.3299 8.74952 15.1072 8.74952 14.875C8.74952 14.6428 8.84176 14.4201 9.00594 14.2559C9.17013 14.0918 9.39281 13.9995 9.625 13.9995C9.8572 13.9995 10.0799 14.0918 10.2441 14.2559L12.25 16.263L17.7559 10.7559C17.8372 10.6746 17.9338 10.6102 18.04 10.5662C18.1462 10.5222 18.26 10.4995 18.375 10.4995C18.49 10.4995 18.6038 10.5222 18.71 10.5662C18.8163 10.6102 18.9128 10.6746 18.9941 10.7559C19.0754 10.8372 19.1399 10.9337 19.1838 11.04C19.2278 11.1462 19.2505 11.26 19.2505 11.375C19.2505 11.49 19.2278 11.6038 19.1838 11.71C19.1399 11.8163 19.0754 11.9128 18.9941 11.9941Z" fill="#10B981"/>
            </svg>
          </div>
          <div class="guide-text">
            <div class="guide-title">Connection Verified</div>
            <div class="guide-desc">Congratulations! You've successfully installed InsForge MCP. Now you can start building your app with InsForge handling backend in your IDE.</div>
          </div>
          <button class="guide-close" onclick="closeGuide()" title="Close">
            <span class="codicon codicon-close"></span>
          </button>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    function toggleOrg(orgId) {
      const content = document.getElementById('content-' + orgId);
      const chevron = document.getElementById('chevron-' + orgId);
      
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        chevron.classList.remove('codicon-chevron-right');
        chevron.classList.add('codicon-chevron-down');
      } else {
        content.classList.add('collapsed');
        chevron.classList.remove('codicon-chevron-down');
        chevron.classList.add('codicon-chevron-right');
      }
    }
    
    function selectProject(orgId, projectId) {
      vscode.postMessage({ command: 'selectProject', orgId, projectId });
    }
    
    function createProject(orgId) {
      vscode.postMessage({ command: 'createProject', orgId });
    }
    
    function installMcp(orgId, projectId) {
      vscode.postMessage({ command: 'installMcp', orgId, projectId });
    }
    
    function retryMcpVerification(orgId, projectId) {
      vscode.postMessage({ command: 'retryMcpVerification', orgId, projectId });
    }
    
    function openInInsforge(orgId) {
      vscode.postMessage({ command: 'openInInsforge', orgId });
    }
    
    function toggleProject(projectId) {
      const content = document.getElementById('project-content-' + projectId);
      const chevron = document.getElementById('project-chevron-' + projectId);
      
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        chevron.classList.remove('codicon-chevron-right');
        chevron.classList.add('codicon-chevron-down');
      } else {
        content.classList.add('collapsed');
        chevron.classList.remove('codicon-chevron-down');
        chevron.classList.add('codicon-chevron-right');
      }
    }
    
    function viewProjectDetails(projectId) {
      vscode.postMessage({ command: 'viewProjectDetails', projectId });
    }
    
    // Guide functions
    function goToStep(step) {
      document.getElementById('step1').classList.add('hidden');
      document.getElementById('step2').classList.add('hidden');
      document.getElementById('stepComplete').classList.add('hidden');
      
      if (step === 1) {
        document.getElementById('step1').classList.remove('hidden');
      } else if (step === 2) {
        document.getElementById('step2').classList.remove('hidden');
      } else {
        document.getElementById('stepComplete').classList.remove('hidden');
      }
    }
    
    function closeGuide() {
      document.getElementById('guideCard').classList.add('hidden');
    }
    
    function copyPrompt() {
      const promptText = "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";
      const copyBtn = document.querySelector('.prompt-copy');
      
      // Prevent clicking if already copying
      if (copyBtn.disabled) return;
      
      const copySvg = '<svg class="copy-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_copy)"><path d="M13.9997 7.3335C13.9997 6.96531 13.7012 6.66683 13.333 6.66683H7.33301C6.96482 6.66683 6.66634 6.96531 6.66634 7.3335V13.3335C6.66634 13.7017 6.96482 14.0002 7.33301 14.0002H13.333C13.7012 14.0002 13.9997 13.7017 13.9997 13.3335V7.3335ZM15.333 13.3335C15.333 14.4381 14.4376 15.3335 13.333 15.3335H7.33301C6.22844 15.3335 5.33301 14.4381 5.33301 13.3335V7.3335C5.33301 6.22893 6.22844 5.3335 7.33301 5.3335H13.333C14.4376 5.3335 15.333 6.22893 15.333 7.3335V13.3335Z" fill="currentColor"/><path d="M9.33366 3.33317V2.6665C9.33366 2.48969 9.26337 2.32017 9.13835 2.19515C9.01332 2.07013 8.8438 1.99984 8.66699 1.99984H2.66699C2.49018 1.99984 2.32066 2.07013 2.19564 2.19515C2.07061 2.32017 2.00033 2.48969 2.00033 2.6665V8.6665C2.00033 8.84332 2.07061 9.01283 2.19564 9.13786C2.32066 9.26288 2.49018 9.33317 2.66699 9.33317H3.33366C3.70185 9.33317 4.00033 9.63165 4.00033 9.99984C4.00033 10.368 3.70185 10.6665 3.33366 10.6665H2.66699C2.13656 10.6665 1.628 10.4556 1.25293 10.0806C0.877857 9.70549 0.666992 9.19694 0.666992 8.6665V2.6665C0.666992 2.13607 0.877857 1.62751 1.25293 1.25244C1.628 0.877369 2.13656 0.666504 2.66699 0.666504H8.66699C9.19743 0.666504 9.70598 0.877369 10.0811 1.25244C10.4561 1.62751 10.667 2.13607 10.667 2.6665V3.33317C10.667 3.70136 10.3685 3.99984 10.0003 3.99984C9.63214 3.99984 9.33366 3.70136 9.33366 3.33317Z" fill="currentColor"/></g><defs><clipPath id="clip0_copy"><rect width="16" height="16" fill="white"/></clipPath></defs></svg>';
      const checkedSvg = '<svg width="16" height="16" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2.625C11.7502 2.625 9.551 3.29213 7.68039 4.54203C5.80978 5.79193 4.35182 7.56847 3.49088 9.64698C2.62993 11.7255 2.40467 14.0126 2.84357 16.2192C3.28248 18.4257 4.36584 20.4525 5.95667 22.0433C7.54749 23.6342 9.57432 24.7175 11.7809 25.1564C13.9874 25.5953 16.2745 25.3701 18.353 24.5091C20.4315 23.6482 22.2081 22.1902 23.458 20.3196C24.7079 18.449 25.375 16.2498 25.375 14C25.3718 10.9841 24.1724 8.09271 22.0398 5.96018C19.9073 3.82764 17.0159 2.62818 14 2.625ZM18.9941 11.9941L12.8691 18.1191C12.7878 18.2004 12.6913 18.265 12.5851 18.309C12.4789 18.353 12.365 18.3757 12.25 18.3757C12.135 18.3757 12.0212 18.353 11.9149 18.309C11.8087 18.265 11.7122 18.2004 11.6309 18.1191L9.00594 15.4941C8.84176 15.3299 8.74952 15.1072 8.74952 14.875C8.74952 14.6428 8.84176 14.4201 9.00594 14.2559C9.17013 14.0918 9.39281 13.9995 9.625 13.9995C9.8572 13.9995 10.0799 14.0918 10.2441 14.2559L12.25 16.263L17.7559 10.7559C17.8372 10.6746 17.9338 10.6102 18.04 10.5662C18.1462 10.5222 18.26 10.4995 18.375 10.4995C18.49 10.4995 18.6038 10.5222 18.71 10.5662C18.8163 10.6102 18.9128 10.6746 18.9941 10.7559C19.0754 10.8372 19.1399 10.9337 19.1838 11.04C19.2278 11.1462 19.2505 11.26 19.2505 11.375C19.2505 11.49 19.2278 11.6038 19.1838 11.71C19.1399 11.8163 19.0754 11.9128 18.9941 11.9941Z" fill="#10B981"/></svg>';
      
      navigator.clipboard.writeText(promptText).then(() => {
        // Change to checked icon and disable button
        copyBtn.disabled = true;
        copyBtn.innerHTML = checkedSvg;
        copyBtn.style.opacity = '0.7';
        
        // Restore after 3 seconds
        setTimeout(() => {
          copyBtn.innerHTML = copySvg;
          copyBtn.disabled = false;
          copyBtn.style.opacity = '1';
        }, 3000);
      });
    }
    
    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'showCompletion':
          // Show completion step
          document.getElementById('step1').classList.add('hidden');
          document.getElementById('step2').classList.add('hidden');
          document.getElementById('stepComplete').classList.remove('hidden');
          document.getElementById('guideCard').classList.remove('hidden');
          
          // Auto-hide after 5 seconds
          setTimeout(() => {
            const guideCard = document.getElementById('guideCard');
            if (guideCard) {
              guideCard.style.transition = 'opacity 0.5s ease-out';
              guideCard.style.opacity = '0';
              setTimeout(() => {
                guideCard.classList.add('hidden');
                guideCard.style.opacity = '1';
              }, 500);
            }
          }, 5000);
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  private _getStyles(): string {
    return `<style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
    }
    
    /* Welcome styles */
    .welcome-container {
      height: 100vh;
      width: 100%;
      max-width: 386px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 20px;
      text-align: center;
    }
    
    .logo {
      width: 80px;
      height: 80px;
      margin-bottom: 24px;
    }
    
    .welcome-text {
      font-size: 14px;
      line-height: 24px;
      color: var(--vscode-foreground);
      margin-bottom: 40px;
    }
    
    /* Button styles */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 10px;
      font-size: 14px;
      line-height: 24px;
      font-family: var(--vscode-font-family);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s ease;
    }
    
    .btn.primary {
      width: 100%;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    
    .btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    /* Projects list styles */
    .projects-container {
      min-height: 100vh;
      padding: 0 0 160px 0;
    }
    
    .org-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
    }
    
    .org-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .org-name {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 24px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .org-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0px 4px;
      font-size: 12px;
      line-height: 21px;
      background-color: #d7d7d7;
      color: #525252;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
    }
    
    body.vscode-dark .org-open-btn {
      background-color: #262626;
      color: #A3A3A3;
    }
    
    .org-header:hover .org-open-btn {
      opacity: 1;
    }
    
    .org-open-btn .codicon {
      font-size: 12px;
    }
    
    .org-content {
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    
    .org-content.collapsed {
      display: none;
    }
    
    .project-section {
      margin-left: 20px;
    }
    
    .project-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      cursor: pointer;
      user-select: none;
    }
    
    .project-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    
    .project-header:hover .install-btn {
      opacity: 1;
    }
    
    .project-name {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      line-height: 24px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .project-content {
      overflow: hidden;
    }
    
    .project-content.collapsed {
      display: none;
    }
    
    .project-details {
      padding: 0 8px 12px 30px;
    }
    
    .detail-row {
      display: flex;
      justify-content: start;
      gap: 8px;
      padding: 4px 0;
    }
    
    .detail-label {
      font-size: 14px;
      line-height: 24px;
      color: var(--vscode-descriptionForeground);
    }
    
    .detail-value {
      font-size: 14px;
      line-height: 24px;
      text-transform: capitalize;
      color: var(--vscode-foreground);
    }
    
    .view-details-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      color: #10B981;
      text-decoration: none;
      cursor: pointer;
    }
    
    .view-details-link .codicon {
      font-size: 20px;
    }
    
    .install-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0px 4px;
      font-size: 12px;
      line-height: 21px;
      background-color: #d7d7d7;
      color: #525252;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    
    body.vscode-dark .install-btn {
      background-color: #262626;
      color: #A3A3A3;
    }
    
    .install-btn .mcp-icon {
      width: 16px;
      height: 16px;
    }
    
    .install-text {
      white-space: nowrap;
    }
    
    /* MCP Status Dots */
    .mcp-verified-dot {
      width: 8px;
      height: 8px;
      background-color: #22C55E;
      border-radius: 50%;
      flex-shrink: 0;
    }
    
    .mcp-verifying-dot {
      width: 8px;
      height: 8px;
      background-color: #EAB308;
      border-radius: 50%;
      flex-shrink: 0;
      animation: pulse 1.5s ease-in-out infinite;
    }
    
    .mcp-failed-btn {
      background: none;
      border: none;
      padding: 0;
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }

    .mcp-failed-btn:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .mcp-failed-dot {
      width: 8px;
      height: 8px;
      background-color: #EF4444;
      border-radius: 50%;
      flex-shrink: 0;
    }
    
    .mcp-failed-dot:hover {
      background-color: #DC2626;
    }
    
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.2);
      }
    }
    
    /* Empty state styles */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      text-align: center;
    }
    
    .folder-icon {
      width: 40px;
      height: 40px;
      margin-bottom: 12px;
      color: #525252;
    }
    
    body.vscode-dark .folder-icon {
      color: #A3A3A3;
    }
    
    .empty-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    
    .empty-desc {
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 32px;
    }
    
    .no-orgs {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    
    /* Codicon styles */
    .codicon {
      font-size: 16px;
    }
    
    /* Guide wrapper - fixed at bottom */
    .guide-wrapper {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 20px;
      z-index: 100;
    }
    
    .guide-card {
      background: var(--vscode-editorWidget-background, #262626);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 8px;
      overflow: hidden;
    }
    
    .guide-card.hidden {
      display: none;
    }
    
    .guide-step {
      display: flex;
      flex-direction: column;
    }
    
    .guide-step.hidden {
      display: none;
    }
    
    .guide-content {
      display: flex;
      gap: 8px;
      padding: 12px;
      align-items: flex-start;
    }
    
    .guide-icon {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000000;
    }
    
    body.vscode-dark .guide-icon {
      color: #ffffff;
    }
    
    .guide-icon svg,
    .guide-icon img {
      width: 28px;
      height: 28px;
    }
    
    .guide-text {
      flex: 1;
      min-width: 0;
    }
    
    .guide-title {
      font-size: 18px;
      font-weight: 600;
      line-height: 28px;
      color: var(--vscode-foreground);
      margin-bottom: 8px;
    }
    
    .guide-desc {
      font-size: 14px;
      line-height: 21px;
      color: var(--vscode-descriptionForeground);
    }
    
    .guide-close {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.6;
    }
    
    .guide-close .codicon {
      font-size: 24px;
    }
    
    /* Prompt box */
    .guide-prompt-box {
      margin-top: 8px;
      padding: 12px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
      border-radius: 8px;
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .prompt-label {
      font-size: 12px;
      line-height: 20px;
      color: var(--vscode-foreground);
      opacity: 0.8;
    }
    
    .prompt-copy {
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      background-color: #e5e5e5;
      color: #525252;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.10);
    }
    
    body.vscode-dark .prompt-copy {
      background-color: #262626;
      color: #A3A3A3;
    }
    
    .prompt-copy svg {
      width: 16px;
      height: 16px;
    }
    
    .prompt-text {
      font-size: 14px;
      line-height: 24px;
      color: var(--vscode-foreground);
      opacity: 0.9;
    }
    
    /* Guide footer with navigation */
    .guide-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-editorWidget-border, #404040);
    }
    
    .guide-step-indicator {
      font-size: 14px;
      line-height: 21px;
      color: var(--vscode-foreground);
      opacity: 0.8;
    }
    
    .guide-nav {
      display: flex;
      gap: 4px;
    }
    
    .guide-nav-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.8;
      transition: opacity 0.15s ease;
    }
    
    .guide-nav-btn:hover:not(:disabled) {
      opacity: 1;
    }
    
    .guide-nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .guide-nav-btn .codicon {
      font-size: 20px;
    }
  </style>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
