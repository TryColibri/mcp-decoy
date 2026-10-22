#!/usr/bin/env node
import { styleText } from 'node:util';

import { intro, log, note, outro } from '@clack/prompts';

import { CLIUsageError, parseCLI, USAGE } from '@/server/cli-options';
import { InvalidConfigFileError } from '@/server/config';
import { type Instance, PortInUseError, start, VERSION } from '@/server/main';
import { AlreadyRunningError } from '@/server/runtime';

const run = async () => {
  let command;
  try {
    command = parseCLI(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CLIUsageError) {
      for (const problem of error.problems) {
        log.error(problem);
      }
      log.message('Run decoy --help for usage.');
      process.exit(2);
    }
    throw error;
  }

  if (command.kind === 'help') {
    console.log(USAGE);
    return;
  }
  if (command.kind === 'version') {
    console.log(VERSION);
    return;
  }

  intro(`${styleText('bold', 'decoy')} ${styleText('dim', `v${VERSION}`)}`);

  let instance: Instance;
  try {
    instance = await start({
      mcpPort: command.mcpPort,
      uiPort: command.uiPort,
      host: command.host,
      configDir: command.configDir,
      logLimit: command.logLimit,
      dev: command.dev,
      onError: (error) => {
        log.error(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
      },
    });
  } catch (error) {
    if (error instanceof InvalidConfigFileError) {
      log.error(
        [
          `Invalid config file ${error.path}`,
          ...error.issues.map((issue) => `  ${issue}`),
        ].join('\n'),
      );
    } else if (
      error instanceof PortInUseError ||
      error instanceof AlreadyRunningError
    ) {
      log.error(error.message);
    } else {
      log.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    process.exit(1);
  }

  const { info } = instance;
  if (!command.dev) {
    log.success(`UI        ${styleText('cyan', instance.uiUrl)}`);
  }
  log.info(`API       ${styleText('cyan', instance.apiUrl)}`);
  log.info(
    `MCP       ${styleText('cyan', info.mcp.urlTemplate.replace('{server}', '<server>'))}`,
  );
  log.info(`Config    ${info.configFile}`);
  log.info(
    instance.servers.length === 0
      ? 'Servers   none yet — create one in the UI'
      : `Servers   ${instance.servers.map((server) => server.name).join(', ')}`,
  );
  note(
    `cloudflared tunnel --url http://localhost:${info.mcp.port}\nngrok http ${info.mcp.port}`,
    'Need HTTPS or a public URL? Tunnel the MCP port only',
  );
  log.message(styleText('dim', 'Press Ctrl+C to stop.'));

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await instance.close();
    outro('decoy stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
};

await run();
