/** datetime-local is deliberately presented as UTC, never parsed in the OS timezone. */
export function parseUtcInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const canonical = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${canonical}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== canonical) return null;
  const year = date.getUTCFullYear();
  return year >= 1962 && year <= 2100 ? date : null;
}

export function formatUtcInput(at: Date): string { return at.toISOString().slice(0, 19); }
