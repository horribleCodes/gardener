export function fillResourceUri(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`Missing param: ${key}`);
    return encodeURIComponent(v);
  });
}

export function templateParamNames(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}
