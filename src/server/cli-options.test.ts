import { describe, expect, it } from 'vitest';

import { CLIUsageError, parseCLI } from './cli-options';

const problemsOf = (argv: string[]): string[] => {
  try {
    parseCLI(argv);
  } catch (error) {
    if (error instanceof CLIUsageError) {
      return error.problems;
    }
    throw error;
  }
  return [];
};

describe('parseCLI', () => {
  it('applies defaults', () => {
    expect(parseCLI([])).toEqual({
      kind: 'start',
      mcpPort: 6280,
      uiPort: 6281,
      host: '127.0.0.1',
      logLimit: 10_000,
      dev: false,
    });
  });

  it('reads every flag', () => {
    expect(
      parseCLI([
        '--mcp-port',
        '7000',
        '--ui-port=7001',
        '--host',
        '0.0.0.0',
        '--config-dir',
        '/tmp/mcp-decoy',
        '--log-limit',
        '500',
        '--dev',
      ]),
    ).toEqual({
      kind: 'start',
      mcpPort: 7000,
      uiPort: 7001,
      host: '0.0.0.0',
      configDir: '/tmp/mcp-decoy',
      logLimit: 500,
      dev: true,
    });
  });

  it('recognizes help and version with aliases', () => {
    expect(parseCLI(['-h'])).toEqual({ kind: 'help' });
    expect(parseCLI(['--help'])).toEqual({ kind: 'help' });
    expect(parseCLI(['-v'])).toEqual({ kind: 'version' });
    expect(parseCLI(['--version'])).toEqual({ kind: 'version' });
  });

  it('rejects out-of-range and non-integer ports', () => {
    expect(problemsOf(['--mcp-port', '0'])).toEqual([
      '--mcp-port: must be an integer between 1 and 65535',
    ]);
    expect(problemsOf(['--ui-port', '70000'])).toEqual([
      '--ui-port: must be an integer between 1 and 65535',
    ]);
    expect(problemsOf(['--mcp-port', 'abc'])).toEqual([
      '--mcp-port: must be a number',
    ]);
  });

  it('rejects a log limit below 100', () => {
    expect(problemsOf(['--log-limit', '99'])).toEqual([
      '--log-limit: must be at least 100',
    ]);
  });

  it('rejects unknown options and stray arguments', () => {
    expect(problemsOf(['--port', '1', 'extra'])).toEqual([
      'Unknown option --port',
      'Unexpected argument: extra',
    ]);
  });

  describe('skill', () => {
    it('prints the skill', () => {
      expect(parseCLI(['skill'])).toEqual({ kind: 'skill' });
    });

    it('installs globally by default', () => {
      expect(parseCLI(['skill', 'install'])).toEqual({
        kind: 'skill-install',
      });
    });

    it('installs under the directory given with --dir', () => {
      expect(parseCLI(['skill', 'install', '--dir', '.'])).toEqual({
        kind: 'skill-install',
        dir: '.',
      });
    });

    it('rejects unknown skill commands and stray arguments', () => {
      expect(problemsOf(['skill', 'remove'])).toEqual([
        'Unknown skill command: remove',
      ]);
      expect(problemsOf(['skill', 'install', 'extra'])).toEqual([
        'Unexpected argument: extra',
      ]);
    });

    it('rejects unknown options', () => {
      expect(problemsOf(['skill', '--nope'])).toEqual([
        'Unknown option --nope',
      ]);
    });

    it('rejects --dir outside skill install', () => {
      expect(problemsOf(['skill', '--dir', 'x'])).toEqual([
        '--dir: only applies to skill install',
      ]);
      expect(problemsOf(['--dir', 'x'])).toEqual([
        '--dir: only applies to skill install',
      ]);
    });

    it('rejects an empty --dir', () => {
      expect(problemsOf(['skill', 'install', '--dir', ''])).toEqual([
        '--dir: must not be empty',
      ]);
    });
  });
});
