import 'dotenv/config';
import dotenv from 'dotenv';
import { ACTIVE_COMMANDS, OPERATOR_COMMANDS } from '../discord/commands.js';
import { registerGlobalCommands, registerGuildCommands } from '../discord/client.js';
import type { AppEnv } from '../env.js';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

const env = {
  DISCORD_BOT_TOKEN: requireEnv('DISCORD_BOT_TOKEN'),
  DISCORD_CLIENT_ID: requireEnv('DISCORD_CLIENT_ID'),
} as AppEnv;
const operatorGuildId = process.env.OPERATOR_GUILD_ID;

await registerGlobalCommands(env, ACTIVE_COMMANDS);
console.log('Registered global Discord commands.');

if (operatorGuildId) {
  await registerGuildCommands(env, operatorGuildId, OPERATOR_COMMANDS);
  console.log(`Registered operator commands for guild ${operatorGuildId}.`);
} else if (!operatorGuildId) {
  console.log('Skipped operator command registration: OPERATOR_GUILD_ID is not set.');
}
