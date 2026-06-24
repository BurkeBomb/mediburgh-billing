import raw from "../data/ICD10.json";
import Fuse from "fuse.js";

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

let cachedList: IcdCodeItem[] | null = null;
let fuse: Fuse<IcdCodeItem> | null = null;

export function loadIcdList(): IcdCodeItem[] {
  if (cachedList) return cachedList;
  // raw structure: { Employees: { Employee: [ ... ] } }
  const items: any[] = raw?.Employees?.Employee || [];

  cachedList = items.map((e) => ({
    code: (e.ICD10CODE || "").trim(),
    description: cleanDescription(e["DESCRIPTION\r"] ?? e.DESCRIPTION),
  }));

  // build fuse index lazily
  fuse = new Fuse(cachedList, {
    keys: ["code", "description"],
    threshold: 0.35,
    includeScore: true,
    minMatchCharLength: 2,
  });

  return cachedList;
}

export function searchIcd(query: string, limit = 25): IcdCodeItem[] {
  const q = query.trim();
  if (!q) return [];

  if (!cachedList || !fuse) loadIcdList();

  if (fuse) {
    const results = fuse.search(q, { limit });
    return results.map((r) => r.item);
  }

  // fallback to substring
  const list = cachedList || [];
  const ql = q.toLowerCase();
  return list.filter((it) => it.code.toLowerCase().includes(ql) || it.description.toLowerCase().includes(ql)).slice(0, limit);
}
