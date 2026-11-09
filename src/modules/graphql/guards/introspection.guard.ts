import { GraphQLError, type ValidationRule } from "graphql";

/**
 * Validation rule to disable GraphQL introspection queries (__schema and __type).
 * Typically enabled in production to prevent schema harvesting by unauthenticated parties.
 */
export const disableIntrospectionRule: ValidationRule = (context) => {
  return {
    Field(node) {
      if (node.name.value === "__schema" || node.name.value === "__type") {
        context.reportError(
          new GraphQLError(
            "GraphQL introspection is disabled.",
            { nodes: [node] }
          )
        );
      }
    },
  };
};

