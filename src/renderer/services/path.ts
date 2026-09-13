export const sep = "/";

export function normalize(p: string): string {
  if (p == null) return p;
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");
}

export function join(...parts: Array<string | null | undefined>): string {
  const cleaned = parts.filter((p) => p != null && p !== "").map((p) => normalize(String(p)));
  if (cleaned.length === 0) return ".";
  if (cleaned.length === 1) return cleaned[0];
  let result = cleaned.join("/").replace(/\/{2,}/g, "/");
  if (result == "") result = ".";
  return result;
}

export function dirname(p: string): string {
  const norm = normalize(p).replace(/\/$/, "");
  if (norm === "" || norm === "/") return "/";
  const index = norm.lastIndexOf("/");
  if (index < 0) return ".";
  return norm.slice(0, index) || "/";
}

export function basename(p: string): string {
  const norm = normalize(p).replace(/\/$/, "");
  if (norm === "") return "";
  const index = norm.lastIndexOf("/");
  return index < 0 ? norm : norm.slice(index + 1);
}