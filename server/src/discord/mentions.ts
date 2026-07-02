import type { AppEnv } from '../env.js';
import { listGlobalCommands } from './client.js';

type CommandCache = { expiresAt: number; commands: Array<{ id: string; name: string }> };

const COMMAND_CACHE_TTL_MS = 10 * 60 * 1000;
let commandCache: CommandCache | null = null;

export async function globalRegisteredCommands(env: AppEnv): Promise<Array<{ id: string; name: string }>> {
  if (commandCache && commandCache.expiresAt > Date.now()) {
    return commandCache.commands;
  }

  const commands = await listGlobalCommands(env).catch(() => []);
  commandCache = { commands, expiresAt: Date.now() + COMMAND_CACHE_TTL_MS };
  return commands;
}

export async function globalCommandMention(env: AppEnv, commandName: string, subcommandName?: string): Promise<string> {
  const commands = await globalRegisteredCommands(env).catch(() => []);
  const command = commands.find((candidate) => candidate.name === commandName);
  if (!command) {
    return subcommandName ? `\`/${commandName} ${subcommandName}\`` : `\`/${commandName}\``;
  }

  return subcommandName ? `</${commandName} ${subcommandName}:${command.id}>` : `</${commandName}:${command.id}>`;
}
