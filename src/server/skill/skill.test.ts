import { describe, expect, it } from 'vitest';

import { renderLLMsText, SKILL, SKILL_NAME } from './skill';

describe('SKILL', () => {
  it('starts with frontmatter that names the skill', () => {
    expect(SKILL).toMatch(/^---\nname: mcp-decoy\ndescription:/);
    expect(SKILL_NAME).toBe('mcp-decoy');
  });

  it('keeps its frontmatter closed', () => {
    expect(SKILL.split('\n---\n')).toHaveLength(2);
  });
});

describe('renderLLMsText', () => {
  it('follows the llms.txt format: title, summary, then a list of links', () => {
    expect(renderLLMsText('http://localhost:6281')).toMatch(
      /^# MCP Decoy\n\n> .+\n\n## Docs\n\n- \[SKILL\.md\]\(http:\/\/localhost:6281\/SKILL\.md\): /,
    );
  });

  it('links every URL under the given origin', () => {
    const urls = renderLLMsText('http://127.0.0.1:9000').match(
      /\]\(([^)]+)\)/g,
    );

    expect(urls).toEqual([
      '](http://127.0.0.1:9000/SKILL.md)',
      '](http://127.0.0.1:9000/api/v1)',
      '](http://127.0.0.1:9000/llms-full.txt)',
    ]);
  });
});
