// ASCII art logo for InsForge
export const INSFORGE_LOGO = `
██╗███╗   ██╗███████╗███████╗ ██████╗ ██████╗  ██████╗ ███████╗
██║████╗  ██║██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
██║██╔██╗ ██║███████╗█████╗  ██║   ██║██████╔╝██║  ███╗█████╗
██║██║╚██╗██║╚════██║██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
██║██║ ╚████║███████║██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
╚═╝╚═╝  ╚═══╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`;

export function getPostInstallMessage(clientName: string): string {
  return `${INSFORGE_LOGO}
✓ InsForge MCP is now configured for ${clientName}!

Next steps:
  1. Restart your coding agent to load InsForge
  2. Try these commands in your agent:

     "Create a posts table with title, content, and author"
     (Sets up your database schema)

     "Add image upload for user profiles"
     (Creates storage bucket and handles file uploads)

Learn more:
  📚 Documentation: https://docs.insforge.dev/introduction
  💬 Discord: https://discord.com/invite/MPxwj5xVvW
  ⭐ GitHub: https://github.com/insforge/insforge
`;
}
