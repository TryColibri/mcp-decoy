import { describe, expect, it } from 'vitest';

import { SKILL, SKILL_NAME } from './skill';

describe('SKILL', () => {
  it('starts with frontmatter that names the skill', () => {
    expect(SKILL).toMatch(/^---\nname: mcp-decoy\ndescription:/);
    expect(SKILL_NAME).toBe('mcp-decoy');
  });

  it('keeps its frontmatter closed', () => {
    expect(SKILL.split('\n---\n')).toHaveLength(2);
  });
});
