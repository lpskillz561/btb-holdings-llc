// Florida DOR (Department of Revenue) land-use code classification.
//
// DOR_UC in the NAL files is a zero-padded numeric string (e.g. "000", "056",
// "099"). The two-digit value 00-99 maps to a standard statewide land-use.
// This replaces the old ATTOM keyword regex with precise, code-driven
// classification — no false positives from words like "rural".
//
// Reference: FL DOR Standard Land Use Codes (property appraiser assessment roll).

/** Human-readable label for each 00-99 DOR use code. */
export const DOR_UC_LABELS = {
  0: "Vacant Residential",
  1: "Single Family",
  2: "Mobile Home",
  3: "Multi-family (10+ units)",
  4: "Condominium",
  5: "Cooperative",
  6: "Retirement Home",
  7: "Miscellaneous Residential",
  8: "Multi-family (<10 units)",
  9: "Residential Common Element",
  10: "Vacant Commercial",
  11: "Stores, one story",
  12: "Mixed use (store + residential/office)",
  13: "Department store",
  14: "Supermarket",
  15: "Regional shopping mall",
  16: "Community shopping center",
  17: "Office, one story",
  18: "Office, multi-story",
  19: "Professional service building",
  20: "Airport / terminal / pier",
  21: "Restaurant / cafeteria",
  22: "Drive-in restaurant",
  23: "Financial institution",
  24: "Insurance company office",
  25: "Repair service shop",
  26: "Service station",
  27: "Auto sales / repair / car wash",
  28: "Parking lot / mobile home park",
  29: "Wholesale outlet / produce house",
  30: "Florist / greenhouse",
  31: "Drive-in theater / open stadium",
  32: "Enclosed theater / auditorium",
  33: "Nightclub / bar / lounge",
  34: "Bowling / skating / gym",
  35: "Tourist attraction",
  36: "Camp",
  37: "Race track",
  38: "Golf course / driving range",
  39: "Hotel / motel",
  40: "Vacant Industrial",
  41: "Light manufacturing",
  42: "Heavy manufacturing",
  43: "Lumber yard / sawmill",
  44: "Packing plant / cannery",
  45: "Food processing / bakery",
  46: "Beverage / distillery",
  47: "Mineral processing / cement",
  48: "Warehouse / distribution / storage",
  49: "Open storage / junkyard",
  50: "Improved Agricultural",
  51: "Cropland (class I)",
  52: "Cropland (class II)",
  53: "Cropland (class III)",
  54: "Timberland (site index 90+)",
  55: "Timberland (site index 80-89)",
  56: "Timberland (site index 70-79)",
  57: "Timberland (site index 60-69)",
  58: "Timberland (site index 50-59)",
  59: "Timberland (unclassified)",
  60: "Grazing land (class I)",
  61: "Grazing land (class II)",
  62: "Grazing land (class III)",
  63: "Grazing land (class IV)",
  64: "Grazing land (class V)",
  65: "Grazing land (class VI)",
  66: "Orchard / grove / citrus",
  67: "Poultry / bees / fish",
  68: "Dairy / feed lot",
  69: "Ornamentals / misc agricultural",
  70: "Vacant Institutional",
  71: "Church",
  72: "Private school / college",
  73: "Private hospital",
  74: "Home for the aged",
  75: "Orphanage / non-profit",
  76: "Mortuary / cemetery",
  77: "Club / lodge / union hall",
  78: "Sanitarium / convalescent home",
  79: "Cultural organization",
  80: "Vacant Governmental",
  81: "Military",
  82: "Forest / park / recreational",
  83: "Public school",
  84: "College (public)",
  85: "Hospital (public)",
  86: "County (non-school)",
  87: "State",
  88: "Federal",
  89: "Municipal",
  90: "Leasehold interest",
  91: "Utility",
  92: "Mining / petroleum / gas",
  93: "Subsurface rights",
  94: "Right-of-way / road / ditch",
  95: "River / lake / submerged land",
  96: "Sewage / waste / marsh / swamp",
  97: "Outdoor recreational / parkland",
  98: "Centrally assessed",
  99: "Acreage not zoned agricultural",
};

// Category buckets. `land` = true means we treat it as land for the vacant-land
// filter (strictly-vacant parcels, undeveloped acreage, and agricultural land).
const VACANT = new Set([0, 10, 40, 70]); // vacant residential/commercial/industrial/institutional
const ACREAGE = 99; // acreage not zoned agricultural = undeveloped rural land

/** Normalize a raw DOR_UC string to its integer code, or null if unparseable. */
export function normalizeUseCode(raw) {
  if (raw === undefined || raw === null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits === "") return null;
  return parseInt(digits, 10);
}

/**
 * Classify a raw DOR_UC string.
 * @returns {{ code:number|null, label:string, category:string, land:boolean }}
 */
export function classifyUseCode(raw) {
  const code = normalizeUseCode(raw);
  if (code === null) return { code: null, label: "Unknown", category: "unknown", land: false };
  const label = DOR_UC_LABELS[code] ?? `Use code ${code}`;

  let category;
  if (VACANT.has(code)) category = "vacant";
  else if (code === ACREAGE) category = "acreage";
  else if (code >= 50 && code <= 69) category = "agricultural";
  else if (code >= 1 && code <= 9) category = "residential";
  else if (code >= 11 && code <= 39) category = "commercial";
  else if (code >= 41 && code <= 49) category = "industrial";
  else if (code >= 71 && code <= 79) category = "institutional";
  else if (code >= 80 && code <= 89) category = "government";
  else category = "misc";

  const land = category === "vacant" || category === "acreage" || category === "agricultural";
  return { code, label, category, land };
}
