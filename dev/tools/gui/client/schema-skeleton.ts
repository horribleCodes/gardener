export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
};

function nonNullType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((entry) => entry !== "null");
  return schema.type;
}

function isObjectSchema(schema: JsonSchema): boolean {
  return nonNullType(schema) === "object" || schema.properties !== undefined;
}

export function schemaSkeleton(schema: JsonSchema | undefined): unknown {
  if (!schema) return {};
  const union = schema.anyOf ?? schema.oneOf;
  if (union && union.length > 0) {
    const objects = union.filter(isObjectSchema);
    if (objects.length > 0) {
      const properties: Record<string, JsonSchema> = {};
      for (const branch of objects) Object.assign(properties, branch.properties ?? {});
      return schemaSkeleton({ type: "object", properties });
    }
    return schemaSkeleton(union[0]);
  }
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const type = nonNullType(schema);
  if (type === "array") {
    if (Array.isArray(schema.items)) return schema.items.map((item) => schemaSkeleton(item));
    if (schema.items) return [schemaSkeleton(schema.items)];
    return [];
  }
  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) out[key] = schemaSkeleton(child);
    return out;
  }
  if (type === "integer" || type === "number") return typeof schema.minimum === "number" ? schema.minimum : 0;
  if (type === "boolean") return false;
  if (type === "string") return "";
  if (type === "null") return null;
  return null;
}
