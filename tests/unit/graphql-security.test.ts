import { describe, it, expect } from "vitest";
import { parse, validate, buildSchema } from "graphql";
import { depthLimit, disableIntrospectionRule } from "../../src/modules/graphql";

const testSchema = buildSchema(`
  type Query {
    post: Post
    user: User
  }
  type Post {
    id: ID
    title: String
    comments: [Comment]
  }
  type Comment {
    id: ID
    content: String
    author: User
  }
  type User {
    id: ID
    name: String
    profile: Profile
  }
  type Profile {
    bio: String
    user: User
  }
`);

describe("GraphQL Security Guards (VULN-BE-07)", () => {
  describe("depthLimit with Named Fragments", () => {
    it("should allow queries with named fragments within depth limit", () => {
      const query = `
        query GetPost {
          post {
            ...PostFields
          }
        }
        fragment PostFields on Post {
          id
          title
          comments {
            id
            content
          }
        }
      `;
      const doc = parse(query);
      const errors = validate(testSchema, doc, [depthLimit(5)]);
      expect(errors).toHaveLength(0);
    });

    it("should reject queries with deeply nested named fragment spreads exceeding limit", () => {
      const deepQuery = `
        query DeepQuery {
          post {
            ...F1
          }
        }
        fragment F1 on Post {
          comments {
            ...F2
          }
        }
        fragment F2 on Comment {
          author {
            ...F3
          }
        }
        fragment F3 on User {
          profile {
            ...F4
          }
        }
        fragment F4 on Profile {
          user {
            ...F5
          }
        }
        fragment F5 on User {
          profile {
            bio
          }
        }
      `;
      const doc = parse(deepQuery);
      const errors = validate(testSchema, doc, [depthLimit(4)]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("exceeds maximum query depth of 4");
    });

    it("should handle recursive or cyclical fragments safely without infinite loop", () => {
      const cyclicalQuery = `
        query CyclicalQuery {
          user {
            ...UserFragment
          }
        }
        fragment UserFragment on User {
          name
          profile {
            user {
              ...UserFragment
            }
          }
        }
      `;
      const doc = parse(cyclicalQuery);
      const errors = validate(testSchema, doc, [depthLimit(3)]);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("disableIntrospectionRule", () => {
    it("should reject __schema introspection query", () => {
      const query = `
        query Introspect {
          __schema {
            types {
              name
            }
          }
        }
      `;
      const doc = parse(query);
      const errors = validate(testSchema, doc, [disableIntrospectionRule]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("GraphQL introspection is disabled");
    });

    it("should allow standard queries when introspection rule is active", () => {
      const query = `
        query NormalQuery {
          post {
            title
          }
        }
      `;
      const doc = parse(query);
      const errors = validate(testSchema, doc, [disableIntrospectionRule]);
      expect(errors).toHaveLength(0);
    });
  });
});

