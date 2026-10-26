#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { styleText } from 'node:util';

import { intro, log, outro } from '@clack/prompts';

import { CLIUsageError, parseCLI, USAGE } from '@/server/cli-options';
import { InvalidConfigFileError } from '@/server/config';
import { type Instance, PortInUseError, start, VERSION } from '@/server/main';
import { AlreadyRunningError } from '@/server/runtime';
import { installSkill, SKILL } from '@/server/skill';

const run = async () => {
  let command;
  try {
    command = parseCLI(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CLIUsageError) {
      for (const problem of error.problems) {
        log.error(problem);
      }
      log.message('Run mcp-decoy --help for usage.');
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

  if (command.kind === 'skill') {
    process.stdout.write(SKILL);
    return;
  }
  if (command.kind === 'skill-install') {
    const { path, replaced, linkPath, link } = await installSkill({
      dir: resolve(command.dir ?? homedir()),
    });
    log.success(
      `${replaced ? 'Updated' : 'Installed'} the MCP Decoy skill: ${path}`,
    );
    if (link === 'skipped') {
      log.warning(
        `${linkPath} already exists and is not a link, so Claude Code won't load this copy. Remove it and run the command again.`,
      );
    } else {
      log.info(`Linked ${linkPath}`);
    }
    log.message(
      'Your coding agent loads it when you ask it to debug an MCP client.',
    );
    return;
  }

  intro(`${styleText('bold', 'MCP Decoy')} ${styleText('dim', `v${VERSION}`)}`);

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
  log.info(`Config    ${info.configFile}`);

  const formatServers = (names: string[]) => {
    const width = Math.max(...names.map((name) => name.length));
    return names
      .map((name) => {
        const url = info.mcp.urlTemplate.replace('{server}', name);
        return `  ${name.padEnd(width)}  ${styleText('cyan', url)}`;
      })
      .join('\n');
  };
  log.info(
    instance.servers.length === 0
      ? 'Servers   none yet — create one in the UI'
      : `Servers\n${formatServers(instance.servers.map((server) => server.name))}`,
  );
  instance.events.on('serverCreated', ({ server }) => {
    log.success(`Server created\n${formatServers([server])}`);
  });
  log.message(styleText('dim', 'Press Ctrl+C to stop.'));

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await instance.close();
    outro('MCP Decoy stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
};

await run();
