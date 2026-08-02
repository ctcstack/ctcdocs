import type { InventorySelection } from '../inventory/inventory-graph.js';
import type { SyncManifest } from '../manifest.js';
interface SidebarLink {
    label: string;
    slug: string;
}
interface SidebarGroup {
    label: string;
    items: Array<SidebarGroup | SidebarLink>;
}
export declare function createSidebar(selection: InventorySelection, manifest: SyncManifest, landingTitles: readonly string[]): SidebarGroup[];
export declare function serializeSidebar(sidebar: readonly SidebarGroup[], sourceHeader: string): string;
export {};
