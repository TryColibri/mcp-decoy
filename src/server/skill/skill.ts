import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, relative } from 'node:path';

import skillText from './SKILL.md?raw';

/** Name of the agent skill, and of the directory it is installed into. */
export const SKILL_NAME = 'mcp-decoy';

/** Contents of the skill's `SKILL.md`, frontmatter included. */
export const SKILL: string = skillText;

/** Where to install the skill. */
export type InstallSkillParams = {
  /**
   * Directory that holds `.agents/` and `.claude/`: the home directory for a
   * global install, the project root for a local one.
   */
  dir: string;
};

/** What happened to the `.claude/skills/mcp-decoy` link. */
export type SkillLinkState =
  /** The link did not exist and was created. */
  | 'created'
  /** The link already pointed at the skill. */
  | 'unchanged'
  /** The link pointed elsewhere and was repointed. */
  | 'replaced'
  /** A real file or directory is in the way, so it was left alone. */
  | 'skipped';

/** Where the skill was installed. */
export type InstallSkillResult = {
  /** Path of the `SKILL.md` that was written. */
  path: string;
  /** Whether a previous copy was overwritten. */
  replaced: boolean;
  /** Path of the link that makes Claude Code find the skill. */
  linkPath: string;
  /** What happened to the link. */
  link: SkillLinkState;
};

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/**
 * Writes the skill to `<dir>/.agents/skills/mcp-decoy/SKILL.md` and links
 * `<dir>/.claude/skills/mcp-decoy` to it, creating directories as needed. It
 * overwrites a previous copy, so that running it again after an upgrade
 * refreshes the skill. A real file or directory at the link's location is never
 * replaced.
 *
 * @param params - Where to install the skill.
 * @returns The files that were written.
 */
export async function installSkill({
  dir,
}: InstallSkillParams): Promise<InstallSkillResult> {
  const skillDir = join(dir, '.agents', 'skills', SKILL_NAME);
  const path = join(skillDir, 'SKILL.md');
  const replaced = await exists(path);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path, SKILL, 'utf8');

  const claudeSkills = join(dir, '.claude', 'skills');
  const linkPath = join(claudeSkills, SKILL_NAME);
  await mkdir(claudeSkills, { recursive: true });
  const link = await linkSkill({ skillDir, linkPath });
  return { path, replaced, linkPath, link };
}

type LinkSkillParams = {
  /** The directory to link to. */
  skillDir: string;
  /** Where the link goes. */
  linkPath: string;
};

const linkSkill = async ({
  skillDir,
  linkPath,
}: LinkSkillParams): Promise<SkillLinkState> => {
  const target = relative(join(linkPath, '..'), skillDir);
  const existing = await lstat(linkPath).catch(() => null);
  if (existing === null) {
    await symlink(target, linkPath, 'dir');
    return 'created';
  }
  if (!existing.isSymbolicLink()) {
    return 'skipped';
  }
  if ((await readlink(linkPath)) === target) {
    return 'unchanged';
  }
  await rm(linkPath);
  await symlink(target, linkPath, 'dir');
  return 'replaced';
};
