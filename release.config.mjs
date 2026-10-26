/** @type {import('semantic-release').Options} */
const config = {
  branches: ['main'],
  repositoryUrl: 'git@github.com:TryColibri/mcp-decoy.git',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        // `refactor` and `perf` change the product without adding a feature.
        // The rest of the rules stay the default ones.
        releaseRules: [
          { type: 'refactor', release: 'patch' },
          { type: 'perf', release: 'patch' },
        ],
      },
    ],
    '@semantic-release/release-notes-generator',
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/git',
      {
        assets: ['package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
    '@semantic-release/github',
  ],
};

export default config;
