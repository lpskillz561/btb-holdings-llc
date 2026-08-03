// FDOR tax-roll data-portal source: discovery + download URLs.
//
// The portal is a SharePoint document library. We enumerate the per-year NAL
// folder via the SharePoint REST API (source of truth for the 67 filenames —
// which include traps like "Dade 23", "Saint Lucie 66", "Saint Johns 65"),
// then download each county zip directly. No auth required.
//
// The roll folder is NOT stable, and pinning it is how Florida broke. FDOR keeps
// only the current roll under .../NAL — `2025F` was there and is now gone,
// replaced by `2026P`. A hard-coded default is therefore a bug with a one-year
// fuse, and a quiet one: the API still answers 200, the folder listing is just
// empty, discovery returns zero files, and the import dies with "No rows loaded"
// that says nothing about why. So when the roll is not pinned we ask the portal
// which rolls exist and take the newest, and when it IS pinned and turns out to
// be empty we fail with the list of what is actually there.

import { fetchJson } from "./http.mjs";

const ORIGIN = "https://floridarevenue.com";
const PORTAL = "/property/dataportal/Documents/PTO Data Portal/Tax Roll Data Files/NAL";

/**
 * Roll year + type, when pinned. "F" = Final (post-VAB), "P" = Preliminary.
 * Both unset means "whatever the portal is publishing now".
 */
export const ROLL_YEAR = process.env.ROLL_YEAR || null;
export const ROLL_TYPE = process.env.ROLL_TYPE || null;

const api = (serverRelative, collection) =>
  `${ORIGIN}/property/dataportal/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(
    serverRelative,
  )}')/${collection}?$select=Name&$top=500`;

/** Direct download URL for one file name inside a roll folder. */
export function fileUrl(name, folder) {
  return `${ORIGIN}${encodeURI(`${PORTAL}/${folder}/${name}`)}`;
}

/**
 * Parse "Saint Lucie 66 Final NAL 2025.zip" -> { countyNo: 66, countyName: "Saint Lucie" }.
 *
 * The county number is OPTIONAL, and that is not defensive programming — FDOR
 * is not consistent about it. The 2026P roll ships "Broward Preliminary NAL
 * 2026.zip" with no number at all, and labels Seminole 58, which is Orange's
 * number. Requiring the number silently dropped Broward, Florida's
 * second-largest county, from every import: 66 files of 67, no warning.
 *
 * Neither quirk can corrupt the data, because the `co_no` stored on a parcel
 * comes from the CSV's own CO_NO column (see lib/transform.mjs) rather than
 * from the filename. What comes from here is the display name and a log line.
 */
export function parseNalFileName(name) {
  const m = name.match(/^(.+?)(?:\s+(\d{2}))?\s+(?:Final|Preliminary)\s+NAL\s+\d{4}\.zip$/i);
  if (!m) return null;
  return {
    countyNo: m[2] ? parseInt(m[2], 10) : null,
    countyName: m[1].trim(),
    fileName: name,
  };
}

/** Roll folder names the portal is currently carrying, newest first. */
export async function listRollFolders(signal) {
  const data = await fetchJson(api(PORTAL, "Folders"), {
    init: { headers: { Accept: "application/json;odata=nometadata" } },
    label: "FDOR roll folder list",
    signal,
  });
  return (data.value || [])
    .map((f) => f.Name)
    .map((name) => {
      const m = /^(\d{4})([FP])$/i.exec(String(name).trim());
      return m ? { folder: String(name).trim(), year: Number(m[1]), type: m[2].toUpperCase() } : null;
    })
    .filter(Boolean)
    // Newest year wins; within a year a Final roll beats a Preliminary one.
    .sort((a, b) => b.year - a.year || (a.type === "F" ? -1 : 1));
}

async function listFiles(folder, signal) {
  const data = await fetchJson(api(`${PORTAL}/${folder}`, "Files"), {
    init: { headers: { Accept: "application/json;odata=nometadata" } },
    label: `FDOR ${folder} listing`,
    signal,
  });
  return (data.value || [])
    .map((f) => f.Name)
    .filter((n) => /Final NAL|Preliminary NAL/i.test(n) && n.toLowerCase().endsWith(".zip"));
}

function toFiles(names, folder) {
  return names
    .map((name) => {
      const parsed = parseNalFileName(name);
      return parsed ? { ...parsed, url: fileUrl(name, folder) } : null;
    })
    .filter(Boolean);
}

/**
 * Fetch the folder listing and return
 * `{ roll, files: [{ countyNo, countyName, fileName, url }] }`.
 *
 * `roll` is the folder actually used, and the caller should log it — with
 * auto-detection on, "which roll did this import load" stops being answerable
 * from the configuration alone.
 */
export async function discoverNalFiles({ signal } = {}) {
  const pinned = ROLL_YEAR && ROLL_TYPE ? `${ROLL_YEAR}${ROLL_TYPE}` : null;
  const available = await listRollFolders(signal);
  const carrying = available.map((r) => r.folder).join(", ") || "nothing";

  if (pinned) {
    const names = await listFiles(pinned, signal);
    if (names.length === 0) {
      throw new Error(
        `FDOR roll ${pinned} has no NAL files. The portal is currently carrying: ${carrying}. ` +
          `Unset ROLL_YEAR/ROLL_TYPE to take the newest automatically.`,
      );
    }
    return { roll: pinned, files: toFiles(names, pinned) };
  }

  for (const candidate of available) {
    const names = await listFiles(candidate.folder, signal);
    if (names.length > 0) {
      return { roll: candidate.folder, files: toFiles(names, candidate.folder) };
    }
  }
  throw new Error(`No FDOR roll folder has any NAL files (looked at: ${carrying}).`);
}

// Display-name fixups: FDOR uses some non-standard county spellings.
const COUNTY_NAME_FIXUPS = {
  Dade: "Miami-Dade",
  "Saint Lucie": "St. Lucie",
  "Saint Johns": "St. Johns",
  Desoto: "DeSoto",
};

/** Normalize an FDOR county name to a display-friendly canonical form. */
export function canonicalCountyName(name) {
  const trimmed = (name || "").trim();
  return COUNTY_NAME_FIXUPS[trimmed] || trimmed;
}
