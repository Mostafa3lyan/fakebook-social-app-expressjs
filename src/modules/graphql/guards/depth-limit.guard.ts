import {
  type ASTVisitor,
  GraphQLError,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from "graphql";

export const depthLimit = (maxDepth: number = 6): ValidationRule => {
  return (context: ValidationContext): ASTVisitor => {
    let hasReported = false;

    const checkDepth = (
      selectionSet: SelectionSetNode | undefined,
      currentDepth: number,
      node: OperationDefinitionNode,
      visitedFragments: Set<string> = new Set(),
    ): void => {
      if (!selectionSet?.selections || hasReported) return;

      if (currentDepth > maxDepth) {
        hasReported = true;
        context.reportError(
          new GraphQLError(
            `Operation '${node.name?.value || "unnamed"}' exceeds maximum query depth of ${maxDepth}.`,
            { nodes: [node] },
          ),
        );
        return;
      }

      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          if (selection.selectionSet) {
            checkDepth(selection.selectionSet, currentDepth + 1, node, new Set(visitedFragments));
          }
        } else if (
          selection.kind === Kind.INLINE_FRAGMENT &&
          selection.selectionSet
        ) {
          checkDepth(selection.selectionSet, currentDepth, node, visitedFragments);
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
          const fragmentName = selection.name.value;
          if (visitedFragments.has(fragmentName)) {
            // Prevent infinite loop on cyclical fragment references
            continue;
          }
          const fragment = context.getFragment(fragmentName);
          if (fragment?.selectionSet) {
            const nextVisited = new Set(visitedFragments);
            nextVisited.add(fragmentName);
            checkDepth(fragment.selectionSet, currentDepth, node, nextVisited);
          }
        }
      }
    };

    return {
      OperationDefinition(node) {
        hasReported = false;
        checkDepth(node.selectionSet, 1, node);
      },
    };
  };
};
