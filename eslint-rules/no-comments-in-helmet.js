// ESLint rule: no-comments-in-helmet
//
// Warns when JSX comments are used inside Helmet components.
// These comments can be rendered as visible text by react-helmet-async,
// causing UI artifacts on the page.
//
// Example of problematic code:
//   <Helmet>
//     <title>My Page</title>
//     <meta name="description" content="..." />
//     ... a JSX comment anywhere inside this element is flagged ...
//   </Helmet>
//
// Kept as line comments on purpose: a block comment cannot quote the literal
// JSX comment delimiters without closing itself early and breaking the parse.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow JSX comments inside Helmet components',
      recommended: true,
    },
    messages: {
      noCommentInHelmet:
        'JSX comments inside <Helmet> may be rendered as visible text by react-helmet-async. Remove this comment or move it outside the Helmet component.',
    },
    schema: [],
  },

  create(context) {
    // helmetDepth must be inside create() so it's per-file, not module-level
    let helmetDepth = 0

    return {
      // Track when we enter a JSX element that is <Helmet> or <HelmetProvider>
      JSXElement(node) {
        const name = getTagName(node)
        if (name === 'Helmet' || name === 'HelmetProvider') {
          helmetDepth++
        }
      },

      'JSXElement:exit'(node) {
        const name = getTagName(node)
        if (name === 'Helmet' || name === 'HelmetProvider') {
          helmetDepth = Math.max(0, helmetDepth - 1)
        }
      },

      // Detect JSX comments — these are JSXExpressionContainer nodes
      // that contain a JSXEmptyExpression (i.e., {/* comment */})
      JSXExpressionContainer(node) {
        if (helmetDepth > 0 && node.expression && node.expression.type === 'JSXEmptyExpression') {
          context.report({
            node,
            messageId: 'noCommentInHelmet',
          })
        }
      },
    }
  },
}

/**
 * Extract the tag name from a JSX element node.
 * Handles both <Tag> and <Namespace:Tag> patterns.
 */
function getTagName(node) {
  const openingName = node.openingElement?.name
  if (!openingName) return null

  if (openingName.type === 'JSXIdentifier') {
    return openingName.name
  }

  if (openingName.type === 'JSXMemberExpression') {
    // e.g., <Helmet.Provider>
    const object = openingName.object
    const property = openingName.property
    if (object.type === 'JSXIdentifier' && property.type === 'JSXIdentifier') {
      return property.name
    }
  }

  return null
}
