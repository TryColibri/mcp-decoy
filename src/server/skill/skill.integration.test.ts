import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSkill, SKILL } from './skill';

describe('installSkill', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-decoy-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the skill to .agents and links it from .claude', async () => {
    const result = await installSkill({ dir });

    expect(result).toEqual({
      path: join(dir, '.agents', 'skills', 'mcp-decoy', 'SKILL.md'),
      replaced: false,
      linkPath: join(dir, '.claude', 'skills', 'mcp-decoy'),
      link: 'created',
    });
    expect(await readFile(result.path, 'utf8')).toBe(SKILL);
    expect(await readlink(result.linkPath)).toBe(
      join('..', '..', '.agents', 'skills', 'mcp-decoy'),
    );
    expect(await readFile(join(result.linkPath, 'SKILL.md'), 'utf8')).toBe(
      SKILL,
    );
  });

  it('overwrites a previous copy and keeps the link', async () => {
    const first = await installSkill({ dir });
    await writeFile(first.path, 'stale', 'utf8');

    const second = await installSkill({ dir });

    expect(second).toMatchObject({ replaced: true, link: 'unchanged' });
    expect(await readFile(second.path, 'utf8')).toBe(SKILL);
  });

  it('repoints a link that points elsewhere', async () => {
    const linkPath = join(dir, '.claude', 'skills', 'mcp-decoy');
    await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
    await symlink('elsewhere', linkPath, 'dir');

    const result = await installSkill({ dir });

    expect(result.link).toBe('replaced');
    expect(await readlink(linkPath)).toBe(
      join('..', '..', '.agents', 'skills', 'mcp-decoy'),
    );
  });

  it('leaves a real directory in the way alone', async () => {
    const linkPath = join(dir, '.claude', 'skills', 'mcp-decoy');
    await mkdir(linkPath, { recursive: true });
    await writeFile(join(linkPath, 'SKILL.md'), 'mine', 'utf8');

    const result = await installSkill({ dir });

    expect(result.link).toBe('skipped');
    expect((await lstat(linkPath)).isDirectory()).toBe(true);
    expect(await readFile(join(linkPath, 'SKILL.md'), 'utf8')).toBe('mine');
    expect(await readFile(result.path, 'utf8')).toBe(SKILL);
  });
});
