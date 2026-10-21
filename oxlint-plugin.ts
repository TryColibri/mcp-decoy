import { defineRule, definePlugin } from '@oxlint/plugins';

/**
 * Disallow arrow functions whose expression body is itself an arrow function
 * (e.g. `x => y => x + y`). Suggests rewriting with an explicit block body.
 */
const noChainedArrow = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow arrow functions whose expression body is itself an arrow function',
    },
    messages: {
      noChainedArrow:
        'Arrow function should not use an expression body that is another arrow function. ' +
        'Use a block body with an explicit return instead.',
      useBlockReturn:
        'Wrap the implicit return in a block body with an explicit `return` statement.',
    },
    hasSuggestions: true,
  },
  create(context) {
    return {
      ArrowFunctionExpression(node) {
        if (node.expression && node.body.type === 'ArrowFunctionExpression') {
          const body = node.body;
          context.report({
            node: body,
            messageId: 'noChainedArrow',
            suggest: [
              {
                messageId: 'useBlockReturn',
                fix: (fixer) =>
                  fixer.replaceText(
                    body,
                    `{ return ${context.sourceCode.getText(body)}; }`,
                  ),
              },
            ],
          });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'loderunner' },
  rules: { 'no-chained-arrow': noChainedArrow },
});
