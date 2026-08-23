export function loadDenyList(): { terms: string[]; source: "env" | "local" | "none"; privateCount: number; publicCount: number };
export function findHits(text: string, terms: string[]): string[];
