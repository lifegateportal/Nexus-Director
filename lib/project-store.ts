import type { AcademyPackage } from "@/lib/schemas/academy";
import type { SiteConfig } from "@/lib/schemas/site-config";
import type { IngestResult, LogicTransformResult } from "@/lib/schemas/blueprint";
import type { UiManifestResult } from "@/lib/schemas/ui-manifest";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type ProjectSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  academy: AcademyPackage | null;
  siteConfig: SiteConfig;
  deliveryInstructions: string;
  chatHistory: ChatMessage[];
  blueprint: IngestResult | null;
  logicResult: LogicTransformResult | null;
  uiResult: UiManifestResult | null;
};

const STORE_KEY = "nexus_projects";

export function listProjects(): ProjectSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ProjectSnapshot[];
  } catch {
    return [];
  }
}

export function saveProject(snapshot: ProjectSnapshot): void {
  const projects = listProjects().filter((p) => p.id !== snapshot.id);
  const updated = [{ ...snapshot, updatedAt: new Date().toISOString() }, ...projects];
  localStorage.setItem(STORE_KEY, JSON.stringify(updated));
}

export function deleteProject(id: string): void {
  const projects = listProjects().filter((p) => p.id !== id);
  localStorage.setItem(STORE_KEY, JSON.stringify(projects));
}

export function generateProjectId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
