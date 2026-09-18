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
      // Ported from Map#hasTeamAccess/getPlayerCount - which team SLOTS this
      // map actually supports, not just how many units happen to be on it
      // (classic-2.json is [true, false, true, true]: team 1 specifically
      // has no access even though teams 2/3 do, so this can't be derived
      // from a simple max-team-index or unit count). Falls back to "all 4"
      // for any map missing the field entirely, rather than leaving every
      // team row hidden.
      teamAccess: data.teamAccess ?? [true, true, true, true],
      data,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
