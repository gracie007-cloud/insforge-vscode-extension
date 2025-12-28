import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';

const AUTH_SECRET_KEY = 'insforge.authToken';
const REFRESH_SECRET_KEY = 'insforge.refreshToken';
const USER_DATA_KEY = 'insforge.userData';

// OAuth configuration
const INSFORGE_URL = 'https://api-beta.insforge.dev'; // Staging API
const OAUTH_CALLBACK_PORT = 54321; // Fixed port for OAuth callback
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;
const DEFAULT_CLIENT_ID = 'clf_huv5ZKVvdNlnflRLVfdcaA'; // Official InsForge VS Code Extension

// OAuth scopes
const SCOPES = 'user:read organizations:read projects:read projects:write';

export interface UserData {
  id: string;
  email: string;
  name?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  type?: string;
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  region: string;
  appkey: string;
  status?: string;
  access_api_key?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  message?: string;
}

export class AuthProvider {
  private context: vscode.ExtensionContext;
  private _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAuth = this._onDidChangeAuth.event;

  private currentOrg: Organization | null = null;
  private currentProject: Project | null = null;

  // OAuth client credentials (will be set after registration)
  private clientId: string = '';
  private clientSecret: string = '';

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Load OAuth credentials from settings or use defaults
    const config = vscode.workspace.getConfiguration('insforge');
    this.clientId = config.get('oauthClientId') || DEFAULT_CLIENT_ID;
    this.clientSecret = config.get('oauthClientSecret') || '';
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  }

  async getAccessToken(): Promise<string | undefined> {
    return this.context.secrets.get(AUTH_SECRET_KEY);
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from verifier (SHA256)
   */
  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Generate random state for CSRF protection
   */
  private generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async login(): Promise<boolean> {
    // Check if OAuth credentials are configured
    if (!this.clientId) {
      const result = await vscode.window.showErrorMessage(
        'OAuth client not configured. Please set your client ID in settings.',
        'Open Settings'
      );
      if (result === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'insforge.oauth');
      }
      return false;
    }

    try {
      // Generate PKCE pair
      const codeVerifier = this.generateCodeVerifier();

      // Generate state for CSRF protection
      const state = this.generateState();

      // Start local callback server with fixed port
      const authResult = await this.startCallbackServer(OAUTH_CALLBACK_PORT, state, codeVerifier, OAUTH_REDIRECT_URI);

      if (authResult) {
        vscode.window.showInformationMessage(`Logged in as ${authResult.email}`);
        return true;
      }

      return false;
    } catch (error) {
      vscode.window.showErrorMessage(`Login failed: ${error}`);
      return false;
    }
  }

  /**
   * Start a temporary HTTP server to receive the OAuth callback
   */
  private async startCallbackServer(
    port: number,
    state: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<UserData | null> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${port}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          // Send response to browser
          res.writeHead(200, { 'Content-Type': 'text/html' });

          if (error) {
            res.end(`
              <html>
                <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff;">
                  <div style="text-align: center;">
                    <h1>Authentication Failed</h1>
                    <p>${error}</p>
                    <p>You can close this window.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            resolve(null);
            return;
          }

          if (returnedState !== state) {
            res.end(`
              <html>
                <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff;">
                  <div style="text-align: center;">
                    <h1>Security Error</h1>
                    <p>Invalid state parameter. Please try again.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            resolve(null);
            return;
          }

          if (!code) {
            res.end(`
              <html>
                <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff;">
                  <div style="text-align: center;">
                    <h1>Error</h1>
                    <p>No authorization code received.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            resolve(null);
            return;
          }

          // Success - show loading message
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff;">
                <div style="text-align: center;">
                  <h1>Success!</h1>
                  <p>Completing authentication...</p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);

          // Exchange code for tokens
          try {
            const tokens = await this.exchangeCodeForTokens(code, codeVerifier, redirectUri);

            if (tokens.error) {
              throw new Error(`${tokens.error}: ${tokens.message || ''}`);
            }

            // Store tokens
            await this.context.secrets.store(AUTH_SECRET_KEY, tokens.access_token);
            if (tokens.refresh_token) {
              await this.context.secrets.store(REFRESH_SECRET_KEY, tokens.refresh_token);
            }

            // Fetch and store user data
            const userData = await this.fetchUserData(tokens.access_token);
            await this.context.globalState.update(USER_DATA_KEY, userData);

            // Update context and notify
            vscode.commands.executeCommand('setContext', 'insforge.isLoggedIn', true);
            this._onDidChangeAuth.fire(true);

            server.close();
            resolve(userData);
          } catch (err) {
            server.close();
            reject(err);
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(port, '127.0.0.1', async () => {
        // Build OAuth URL
        const codeChallenge = this.generateCodeChallenge(codeVerifier);
        const authUrl = new URL(`${INSFORGE_URL}/api/oauth/v1/authorize`);
        authUrl.searchParams.set('client_id', this.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Open browser for OAuth
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
        vscode.window.showInformationMessage('Complete login in your browser...');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        resolve(null);
      }, 5 * 60 * 1000);

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Please close any other application using this port and try again.`));
        } else {
          reject(err);
        }
      });
    });
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<TokenResponse> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier,
    };

    // Add client secret if available (for confidential clients)
    if (this.clientSecret) {
      body.client_secret = this.clientSecret;
    }

    const response = await fetch(`${INSFORGE_URL}/api/oauth/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.statusText}. ${error}`);
    }

    return response.json() as Promise<TokenResponse>;
  }

  private async fetchUserData(accessToken: string): Promise<UserData> {
    const response = await fetch(`${INSFORGE_URL}/auth/v1/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user data: ${response.statusText}`);
    }

    const data = await response.json() as { user: UserData };
    return data.user;
  }

  async logout(): Promise<void> {
    await this.context.secrets.delete(AUTH_SECRET_KEY);
    await this.context.secrets.delete(REFRESH_SECRET_KEY);
    await this.context.globalState.update(USER_DATA_KEY, undefined);

    this.currentOrg = null;
    this.currentProject = null;

    vscode.commands.executeCommand('setContext', 'insforge.isLoggedIn', false);
    this._onDidChangeAuth.fire(false);

    vscode.window.showInformationMessage('Logged out from InsForge');
  }

  async getOrganizations(): Promise<Organization[]> {
    const token = await this.getAccessToken();
    if (!token) {
      return [];
    }

    try {
      const response = await fetch(`${INSFORGE_URL}/organizations/v1`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch organizations: ${response.statusText}`);
      }

      const data = await response.json() as { organizations: Organization[] };
      return data.organizations || [];
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
      return [];
    }
  }

  async getProjects(organizationId: string): Promise<Project[]> {
    const token = await this.getAccessToken();
    if (!token) {
      return [];
    }

    try {
      const response = await fetch(`${INSFORGE_URL}/organizations/v1/${organizationId}/projects`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }

      const data = await response.json() as { projects: Project[] };
      return data.projects || [];
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      return [];
    }
  }

  async getProjectApiKey(projectId: string): Promise<string | null> {
    const token = await this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${INSFORGE_URL}/projects/v1/${projectId}/access-api-key`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { access_api_key: string };
      return data.access_api_key;
    } catch (error) {
      console.error('Failed to fetch API key:', error);
      return null;
    }
  }

  getCurrentOrg(): Organization | null {
    return this.currentOrg;
  }

  setCurrentOrg(org: Organization | null): void {
    this.currentOrg = org;
  }

  getCurrentProject(): Project | null {
    return this.currentProject;
  }

  setCurrentProject(project: Project | null): void {
    this.currentProject = project;
  }

  getUserData(): UserData | undefined {
    return this.context.globalState.get<UserData>(USER_DATA_KEY);
  }

  /**
   * Set OAuth credentials programmatically
   */
  setCredentials(clientId: string, clientSecret?: string): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret || '';
  }
}
