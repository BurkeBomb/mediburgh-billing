import raw from "../data/ICD10.json";

export interface IcdCodeItem {
  code: string;
  description: string;
}

function cleanDescription(rawDesc: any) {
  if (!rawDesc) return "";
  return String(rawDesc)
    .replace(/\r/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

export function loadIcdList(): IcdCodeItem[] {
  // raw structure: { Employees: { Employee: [ ... ] } }
  const items: any[] = raw?.Employees?.Employee || [];

  return items.map((e) => ({
    code: (e.ICD10CODE || "").trim(),
    description: cleanDescription(e["DESCRIPTION\r"] ?? e.DESCRIPTION),
  }));
}

export function searchIcd(query: string, limit = 25): IcdCodeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const list = loadIcdList();

  const results = list.filter((it) => {
    return (
      it.code.toLowerCase().includes(q) ||
      it.description.toLowerCase().includes(q)
    );
  });

  return results.slice(0, limit);
}
