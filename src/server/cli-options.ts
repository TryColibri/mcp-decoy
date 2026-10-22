import { parse } from '@bomb.sh/args';
import { z } from 'zod';

/** Default port of the MCP listener. */
export const DEFAULT_MCP_PORT = 6280;
/** Default port of the UI listener. */
export const DEFAULT_UI_PORT = 6281;
/** Default bind address of the MCP listener. */
export const DEFAULT_HOST = '127.0.0.1';
/** Default number of log entries kept in memory. */
export const DEFAULT_LOG_LIMIT = 10_000;

/** What the command line asks for. */
export type CLICommand =
  | {
      /** Print usage and exit. */
      kind: 'help';
    }
  | {
      /** Print the version and exit. */
      kind: 'version';
    }
  | {
      /** Start decoy. */
      kind: 'start';
      /** Port of the MCP listener. */
      mcpPort: number;
      /** Port of the UI listener. */
      uiPort: number;
      /** Bind address of the MCP listener. */
      host: string;
      /** Config directory override. */
      configDir?: string;
      /** Maximum number of log entries kept in memory. */
      logLimit: number;
      /** Dev mode (hidden flag). */
      dev: boolean;
    };

/** The command line is invalid. Carries one readable line per problem. */
export class CLIUsageError extends Error {
  override name = 'CLIUsageError';

  /** One line per problem, e.g. `--mcp-port: must be an integer between 1 and 65535`. */
  readonly problems: string[];

  /** @param problems - One line per problem. */
  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

/** Usage text printed by `--help`. */
export const USAGE = `Usage: decoy [options]

A configurable mock MCP server with a live web UI, for debugging MCP clients.

Options:
  --mcp-port <port>    Port of the MCP listener (default ${DEFAULT_MCP_PORT})
  --ui-port <port>     Port of the UI and API listener (default ${DEFAULT_UI_PORT})
  --host <address>     Bind address of the MCP listener (default ${DEFAULT_HOST})
                       The UI listener always binds 127.0.0.1.
  --config-dir <path>  Where servers.json is stored (default: $XDG_CONFIG_HOME/decoy or ~/.config/decoy)
  --log-limit <n>      Messages kept in memory, across servers (default ${DEFAULT_LOG_LIMIT}, min 100)
  -h, --help           Show this help
  -v, --version        Show the version`;

const port = (flag: string) =>
  z.coerce
    .number<string>({ error: `${flag}: must be a number` })
    .int(`${flag}: must be an integer between 1 and 65535`)
    .min(1, `${flag}: must be an integer between 1 and 65535`)
    .max(65_535, `${flag}: must be an integer between 1 and 65535`);

const flagsSchema = z.object({
  'mcp-port': port('--mcp-port'),
  'ui-port': port('--ui-port'),
  host: z.string().min(1, '--host: must not be empty'),
  'config-dir': z.string().min(1, '--config-dir: must not be empty').optional(),
  'log-limit': z.coerce
    .number<string>({ error: '--log-limit: must be a number' })
    .int('--log-limit: must be an integer')
    .min(100, '--log-limit: must be at least 100'),
});

const KNOWN_FLAGS = new Set([
  'mcp-port',
  'ui-port',
  'host',
  'config-dir',
  'log-limit',
  'help',
  'h',
  'version',
  'v',
  'dev',
  '_',
]);

/**
 * Parses and validates command-line arguments.
 *
 * @param argv - Arguments after the executable and script, e.g. `process.argv.slice(2)`.
 * @throws {CLIUsageError} When a flag is unknown or a value is invalid.
 */
export function parseCLI(argv: string[]): CLICommand {
  const args = parse(argv, {
    string: ['mcp-port', 'ui-port', 'host', 'config-dir', 'log-limit'],
    boolean: ['help', 'version', 'dev'],
    alias: { h: 'help', v: 'version' },
    default: {
      'mcp-port': String(DEFAULT_MCP_PORT),
      'ui-port': String(DEFAULT_UI_PORT),
      host: DEFAULT_HOST,
      'log-limit': String(DEFAULT_LOG_LIMIT),
    },
  });

  if (args.help) {
    return { kind: 'help' };
  }
  if (args.version) {
    return { kind: 'version' };
  }

  const problems: string[] = [];
  for (const key of Object.keys(args)) {
    if (!KNOWN_FLAGS.has(key)) {
      problems.push(`Unknown option --${key}`);
    }
  }
  if (args._.length > 0) {
    problems.push(`Unexpected argument: ${args._.join(' ')}`);
  }

  const result = flagsSchema.safeParse(args);
  if (!result.success) {
    problems.push(...result.error.issues.map((issue) => issue.message));
  }
  if (!result.success || problems.length > 0) {
    throw new CLIUsageError(problems);
  }

  return {
    kind: 'start',
    mcpPort: result.data['mcp-port'],
    uiPort: result.data['ui-port'],
    host: result.data.host,
    ...(result.data['config-dir'] === undefined
      ? {}
      : { configDir: result.data['config-dir'] }),
    logLimit: result.data['log-limit'],
    dev: args.dev === true,
  };
}
