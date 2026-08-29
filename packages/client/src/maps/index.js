/**
 * Auto-discovers every .json map file dropped into this folder - no manual
 * registration needed as more maps get migrated from the original game (see
 * scripts/map-format.js for .aem -> .json conversion). Uses Vite's
 * import.meta.glob (eager, so the whole list is available synchronously for
 * the skirmish setup screen) instead of a hand-maintained index file.
 */
const modules = import.meta.glob("./*.json", { eager: true });

export const MAPS = Object.entries(modules)
  .map(([path, mod]) => {
    const fileName = path.split("/").pop().replace(/\.json$/, "");
    const data = mod.default ?? mod;
    return {
      id: fileName,
      name: fileName,
      author: data.author ?? "",
      width: data.width,
      height: data.height,
      unitCount: data.units?.length ?? 0,
      data,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
