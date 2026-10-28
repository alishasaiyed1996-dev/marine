/**
 * eBay → website category mapping (pure, no server bootstrap).
 *
 * The old importer matched only the raw eBay category NAME against the website
 * Category names (exact, or a length-checked substring). Most eBay listings
 * carry marketplace taxonomy leaf names ("Industrial Electrical Equipment",
 * "Engine Components") instead of the store's own names, so nearly every
 * product fell through to categoryId NULL — and rows that did match could land
 * in the wrong category ("Hydraulics" swallowing "Hydraulic Pumps & Motors",
 * or "Other" swallowing unrelated listings).
 *
 * This module assigns the website category the way an auditor would:
 *   1. An explicit pin from EBAY_CATEGORY_ID_MAP (eBay category ID → slug).
 *   2. eBay category-name aliases (the store's own category mirroring names
 *      plus common eBay taxonomy leaf names).
 *   3. Ordered keyword rules — most specific first — evaluated against the
 *      eBay category name, then the listing title, then item specifics.
 *   4. Fallback 'other-business' (the catalog's existing catch-all), never a
 *      blank category, so the publish gate and category filters stay coherent.
 *
 * Every result carries a confidence + the signal it matched on, so logs, the
 * recategorization script and admin review can distinguish a pinned ID from a
 * keyword guess from the fallback.
 */

export const FALLBACK_CATEGORY_SLUG = 'other-business'

export type CategoryConfidence = 'ebay-category-id' | 'ebay-category' | 'keyword' | 'fallback'

export interface CategoryAssignment {
  slug: string
  confidence: CategoryConfidence
  /** Human-readable trace: which phase and which input won. */
  reason: string
}

export interface CategorySourceInput {
  /** eBay PrimaryCategory.CategoryID */
  categoryId?: string | null
  /** eBay PrimaryCategory.CategoryName (leaf name) */
  categoryName?: string | null
  /** Cleaned listing title */
  title?: string | null
  /** eBay item specifics (Brand/Model/Product Type/…) as "key: value" hints */
  specifics?: Array<{ name: string; value: string }>
}

// ─── Site categories (seed.ts / Category table slugs) ──────────

const SITE_CATEGORY_SLUGS = [
  'electrical',
  'engine-parts',
  'engine-spare',
  'tools-equipment',
  'hand-tools',
  'hydraulic-pumps',
  'hydraulic',
  'lifting-handling',
  'marine-pumps',
  'motor-components',
  'other-business',
  'pneumatic',
  'rigging',
  'safety',
  'ship-machinery',
  'ship-navigation',
  'marine',
  'spares',
  'surplus',
] as const

export type WebsiteCategorySlug = (typeof SITE_CATEGORY_SLUGS)[number]

export function isWebsiteCategorySlug(value: string | null | undefined): boolean {
  if (!value) return false
  return (SITE_CATEGORY_SLUGS as readonly string[]).includes(value)
}

// ─── Text normalization ────────────────────────────────────────

export function normalizeCategoryText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CompiledKeyword {
  slug: string
  keyword: string
  source: string /* pre-normalized keyword as written in the rules */
  regExp: RegExp
}

/**
 * One word-boundary matcher per keyword. `value` must already be normalized
 * with normalizeCategoryText(); the pattern enforces token boundaries so
 * "motor" does not fire inside "motorsport"'s substring space (word-level
 * phrase matching, not substring matching).
 */
function compileKeyword(slug: string, rawKeyword: string): CompiledKeyword | null {
  const keyword = normalizeCategoryText(rawKeyword)
  if (!keyword) return null
  return {
    slug,
    keyword: rawKeyword,
    source: keyword,
    regExp: new RegExp(`(^| )${escapeRegex(keyword)}( |$)`),
  }
}

function matches(text: string, compiled: CompiledKeyword): boolean {
  return compiled.regExp.test(text)
}

// ─── Phase 2: eBay category-name aliases ───────────────────────

/** Alias lists are written pre-normalized (lowercase, "&" → "and"). */

const CATEGORY_ALIASES: Array<{ slug: WebsiteCategorySlug; aliases: string[] }> = [
  { slug: 'hydraulic-pumps', aliases: [
    'hydraulic pumps and motors', 'hydraulic pumps and motor', 'hydraulic pumps', 'hydraulic pump', 'hydraulic motor', 'hydraulic motors',
  ] },
  { slug: 'marine-pumps', aliases: ['marine pumps', 'marine pump', 'pumps', 'pump'] },
  { slug: 'engine-spare', aliases: [
    'engine spare', 'engine spares', 'engine spare parts', 'main engine spare', 'main engine spares', 'auxiliary engine spare', 'gen set spare', 'genset spare',
  ] },
  { slug: 'engine-parts', aliases: [
    'engine parts', 'engine components', 'diesel engine parts', 'marine engine parts', 'engine internals',
    'cylinder heads and valves', 'fuel injection system', 'fuel injection', 'turbochargers and superchargers',
  ] },
  { slug: 'ship-navigation', aliases: [
    'ship navigation', 'navigation equipment', 'marine navigation', 'navigation and bridge equipment',
    'bridge and navigation equipment', 'navigation', 'radio communication',
  ] },
  { slug: 'safety', aliases: [
    'safety', 'safety equipment', 'safety and survival', 'fire safety and survival', 'personal protective equipment',
  ] },
  { slug: 'rigging', aliases: ['rigging', 'rigging and lashing', 'rigging hardware'] },
  { slug: 'lifting-handling', aliases: [
    'lifting and handling', 'material handling', 'lifting equipment and accessories', 'lifting',
  ] },
  { slug: 'electrical', aliases: [
    'electrical and automation', 'electrical equipment', 'electrical', 'industrial electrical',
    'industrial automation and control', 'automation and control systems', 'automation and control',
    'control systems and plc', 'switchgear and distribution', 'automation',
  ] },
  { slug: 'pneumatic', aliases: [
    'pneumatics', 'pneumatic', 'pneumatic systems', 'pneumatic system', 'pneumatics and air tools',
  ] },
  { slug: 'motor-components', aliases: [
    'motors and components', 'motor and components', 'electric motors', 'motors', 'motor',
  ] },
  { slug: 'ship-machinery', aliases: [
    'ship machinery', 'ship machineries', 'deck machinery', 'machinery', 'marine machinery',
  ] },
  { slug: 'tools-equipment', aliases: [
    'equipments and tools', 'equipment and tools', 'tools and equipment', 'power tools and equipment',
    'industrial tools', 'welding and soldering equipment', 'measuring and layout tools', 'shop equipment',
  ] },
  { slug: 'hand-tools', aliases: ['hand tools', 'hand tool', 'wrenches and spanners'] },
  { slug: 'hydraulic', aliases: [
    'hydraulics', 'hydraulic systems', 'hydraulic system', 'hydraulic', 'hydraulic valves and parts',
  ] },
  { slug: 'marine', aliases: ['marine equipment', 'marine', 'nautical equipment'] },
  { slug: 'spares', aliases: ['industrial spare parts', 'spare parts', 'spares', 'industrial spares'] },
  { slug: 'surplus', aliases: ['surplus inventory', 'surplus', 'surplus stock'] },
  { slug: 'other-business', aliases: [
    'other business and industrial', 'other businesss and industrial', 'other industries business', 'other',
  ] },
]

/** Keyword aliases applied to the eBay category name only (safety net). */
const CATEGORY_NAME_KEYWORD_RULES: Array<{ slug: WebsiteCategorySlug; keywords: string[] }> = [
  { slug: 'hydraulic-pumps', keywords: ['hydraulic pumps', 'hydraulic pump', 'hydraulic motors'] },
  { slug: 'marine-pumps', keywords: ['marine pumps', 'seawater pump', 'pump parts'] },
  { slug: 'ship-navigation', keywords: ['radar', 'gyro', 'compass', 'sonar', 'navigation', 'radio'] },
  { slug: 'safety', keywords: ['safety', 'firefighting', 'survival'] },
  { slug: 'engine-spare', keywords: ['engine spares', 'engine spare', 'main engine'] },
  { slug: 'engine-parts', keywords: [
    'engine parts', 'engine components', 'diesel engine', 'engine', 'fuel injection', 'turbocharger', 'cylinder', 'piston', 'crankshaft',
  ] },
  { slug: 'electrical', keywords: ['electrical', 'automation', 'breaker', 'switchgear', 'control'] },
  { slug: 'pneumatic', keywords: ['pneumatic', 'pneumatics'] },
  { slug: 'motor-components', keywords: ['motors', 'electric motor', 'motor components'] },
  { slug: 'hand-tools', keywords: ['hand tools', 'spanner', 'wrench', 'screwdriver', 'plier'] },
  { slug: 'tools-equipment', keywords: ['tools', 'equipments', 'equipment', 'welding', 'measuring'] },
  { slug: 'rigging', keywords: ['rigging', 'shackle', 'lashing'] },
  { slug: 'lifting-handling', keywords: ['lifting', 'hoist', 'crane'] },
  { slug: 'ship-machinery', keywords: ['machinery', 'compressor', 'purifier', 'separator', 'winch'] },
  { slug: 'hydraulic', keywords: ['hydraulic'] },
  { slug: 'marine-pumps', keywords: ['pumps', 'pump'] },
  { slug: 'marine', keywords: ['marine', 'nautical'] },
  { slug: 'spares', keywords: ['spare parts', 'spares'] },
  { slug: 'surplus', keywords: ['surplus'] },
]

// ─── Phase 3: ordered keyword rules (title / specifics) ────────

/**
 * First match wins, so the most specific rules sit at the top: "Rexroth
 * hydraulic pump" must resolve to hydraulic-pumps *before* the generic
 * hydraulic rule sees the word "hydraulic", a "Marine bilge pump" to
 * marine-pumps before the generic spares fallback, etc.
 *
 * Keywords are matched as normalized word-boundary phrases; brands are
 * included deliberately (this catalog IS maker-branded surplus) but always
 * ranked behind product-type rules.
 */
const CATEGORY_KEYWORD_RULES: Array<{ slug: WebsiteCategorySlug; keywords: string[] }> = [
  { slug: 'hydraulic-pumps', keywords: [
    'hydraulic pump', 'hydraulic motor', 'hydraulic gear pump', 'hydraulic piston pump', 'hydraulic vane pump',
    'a10v', 'a10vso', 'a11v', 'a4v', 'a4vg', 'a4vso', 'a2f', 'a2fo', 'k3v', 'k5v', 'pvd pump', 'pvq', 'pvs', 'pvh',
    'hydraulic power pack', 'hpu',
    'rexroth hydraulic', 'vickers hydraulic', 'parker hydraulic', 'denison hydraulic', 'danfoss hydraulic',
    'eaton hydraulic', 'linde hydraulic', 'hagglunds', 'staffa', 'nachi hydraulic', 'kawasaki hydraulic',
    'tokyo keiki hydraulic', 'hydromatic',
  ] },
  { slug: 'marine-pumps', keywords: [
    'marine pump', 'bilge pump', 'ballast pump', 'cargo pump', 'stripping pump', 'sea water pump', 'seawater pump',
    'deep well pump', 'centrifugal pump', 'screw pump', 'duplex pump', 'booster pump', 'transfer pump', 'fire pump',
    'water pump', 'oil pump', 'gear pump', 'vane pump', 'pump shaft', 'pump impeller', 'pump casing',
    'pump mechanical seal', 'pump parts',
    'allweiler', 'desmi', 'imo pump', 'bornemann', 'shinko', 'teikoku', 'sekigahara', 'viking pump', 'grundfos',
    'sihi', 'flygt', 'houttuin', 'svanehoj', 'hamworthy pump', 'dean pump', 'ir pump', 'pump',
  ] },
  { slug: 'engine-spare', keywords: [
    'main engine spare', 'auxiliary engine spare', 'engine spare parts', 'engine spares', 'engine spare',
    'genset spares', 'gen set spares',
  ] },
  { slug: 'engine-parts', keywords: [
    'piston', 'piston crown', 'piston ring', 'cylinder liner', 'cylinder head', 'crankshaft', 'camshaft', 'cam shaft',
    'connecting rod', 'con rod', 'conrod', 'turbo charger', 'turbocharger', 'turbo rotor', 'exhaust valve',
    'inlet valve', 'fuel injector', 'injector nozzle', 'injector plunger', 'delivery valve', 'nozzle', 'plunger',
    'rocker arm', 'push rod', 'pushrod', 'gudgeon pin', 'main bearing', 'crank bearing', 'circular bearing',
    'bearing shell', 'thermostat valve', 'lube oil pump', 'lub oil pump', 'jacket cooling', 'head gasket',
    'gasket kit', 'sump', 'crankcase', 'air starter', 'engine cooling', 'oil cooler', 'seawater cooling', 'engine mounting',
    'flexible coupling engine', 'crankcase relief', 'diesel engine', 'marine engine', 'engine parts',
    'caterpillar', 'cummins', 'sulzer', 'wartsila', 'man b and w', 'daihatsu', 'yanmar', 'mitsubishi engine',
    'niigata', 'akasaka', 'hanomag', 'perkins', 'volvo penta', 'deutz', 'mak engine', 'mak', 'pielstick',
    'stork engine', 'mirrlees',
  ] },
  { slug: 'motor-components', keywords: [
    'motor stator', 'motor rotor', 'servo motor', 'stepper motor', 'ac motor', 'dc motor', 'electric motor',
    'blower motor', 'fan motor', 'brake coil', 'motor winding', 'commutator', 'carbon brush', 'tachogenerator',
    'tachometer', 'rotor', 'stator', 'blower', 'axial fan', 'electric fan', 'motor',
  ] },
  { slug: 'ship-navigation', keywords: [
    'radar', 'gyro compass', 'gyrocompass', 'gyro sphere', 'repeater compass', 'magnetic compass', 'sextant',
    'binocular', 'navtex', 'inmarsat', 'vhf radio', 'vhf transceiver', 'ssb radio', 'radio telex', 'telex',
    'echo sounder', 'echosounder', 'sonar', 'anemometer', 'speed log', 'doppler log', 'gps', 'chartplotter',
    'ais transponder', 'autopilot', 'heading repeater', 'navigation repeater',
    'furuno', 'jrc', 'koden', 'anritsu', 'sperry', 'sailor', 'skanti', 'thrane', 'kongsberg', 'decca',
    'kelvin hughes', 'saura', 'ritter', 'wempe', 'tamaya', 'c plath', 'cassens', 'plath', 'simrad', 'loran',
    'navigation', 'magnetic azimuth',
  ] },
  { slug: 'safety', keywords: [
    'life jacket', 'lifejacket', 'life boat', 'lifeboat', 'life raft', 'liferaft', 'immersion suit', 'survival suit',
    'fire extinguisher', 'fire hose', 'fire nozzle', 'fire blanket', 'fireman outfit', 'fireman', 'fire suit',
    'breathing apparatus', 'scba', 'eebd', 'escape breathing', 'resuscitator', 'stretcher', 'first aid',
    'safety goggles', 'safety helmet', 'hard hat', 'safety glove', 'safety belt', 'safety harness', 'safety lanyard',
    'gas detector', 'oxygen analyser', 'oxygen meter', 'explosimeter', 'multigas detector', 'pyrotechnics',
    'parachute flare', 'rocket parachute', 'smoke buoy', 'lifebuoy', 'life buoy', 'rescue boat', 'solas',
    'collisions', 'msa', 'drager', 'draeger', 'lalizas', 'survival craft', 'flame retardant', 'aluminized suit',
    'safety',
  ] },
  { slug: 'rigging', keywords: [
    'shackle', 'bow shackle', 'dee shackle', 'd shackle', 'jaw end', 'turnbuckle', 'swivel eye', 'master link',
    'd link', 'link plate', 'thimble', 'wire rope clip', 'rope clip', 'd ring', 'lifting ring', 'eye bolt',
    'eye nut', 'ramshorn hook', 'cargo hook', 'anchor chain', 'chain stopper', 'lashing rod', 'lashing',
    'twist lock', 'container lashing', 'wire rope', 'swivel', 'crosby', 'rigging', 'hook',
  ] },
  { slug: 'lifting-handling', keywords: [
    'chain block', 'chain hoist', 'lever hoist', 'ratchet lever', 'pulley block', 'snatch block',
    'lifting beam', 'lifting spreader', 'lifting sling', 'webbing sling', 'chain sling', 'wire rope sling',
    'pallet truck', 'pallet jack', 'forklift', 'hand pallet', 'crane spare', 'jib crane', 'gantry', 'hoist',
    'crane', 'winch', 'windlass', 'capstan', 'mooring winch', 'tugger winch', 'lifting', 'chain pulley',
    'yale', 'kito', 'demag', 'lodestar', 'coffing',
  ] },
  { slug: 'pneumatic', keywords: [
    'pneumatic cylinder', 'air cylinder', 'pneumatic valve', 'solenoid valve', 'air regulator', 'frl unit', 'frl',
    'filter regulator', 'pneumatic fitting', 'pneumatic hose', 'pneumatic tool', 'air tool', 'vacuum ejector',
    'vacuum generator', 'pneumatic gripper', 'air preparation', 'pneumatic',
    'smc', 'festo', 'ckd', 'camozzi', 'norgren', 'wilkerson', 'azbil', 'bimba', 'clippard', 'herion', 'numatics',
    'dunlop pneumatic',
  ] },
  { slug: 'hydraulic', keywords: [
    'hydraulic cylinder', 'hydraulic valve', 'directional control valve', 'directional valve', 'proportional valve',
    'servo valve', 'pressure relief valve', 'relief valve', 'flow control valve', 'check valve', 'cartridge valve',
    'valve plate', 'counterbalance valve', 'hydraulic hose', 'hydraulic fitting', 'quick release coupling',
    'hydraulic power unit', 'accumulator', 'hydraulic filter', 'hydraulic seal', 'hydraulic steering',
    'hydraulic press', 'hydraulic', 'rexroth', 'vickers', 'denison', 'bosch rexroth', 'hydronit',
  ] },
  { slug: 'electrical', keywords: [
    'circuit breaker', 'air circuit breaker', 'mccb', 'moulded case', 'elcb', 'rccb', 'contactor', 'overload relay',
    'soft starter', 'vfd', 'variable frequency drive', 'inverter drive', 'frequency converter', 'ups', 'inverter',
    'rectifier', 'power supply', 'plc', 'hmi', 'plc module', 'plc card', 'i o module', 'input module',
    'output module', 'relay module', 'control module', 'pid controller', 'temperature controller', 'thermocouple',
    'rtd', 'pt100', 'pressure transmitter', 'pressure switch', 'flow switch', 'level switch', 'level transmitter',
    'proximity sensor', 'photoelectric sensor', 'limit switch', 'float switch', 'temperature switch',
    'fuse', 'fuse link', 'terminal block', 'cable gland', 'junction box', 'battery', 'battery charger',
    'battery charger rectifier', 'emergency light', 'spark plug', 'ammeter', 'voltmeter', 'multimeter',
    'frequency meter', 'power meter', 'energy meter', 'panel meter', 'megger', 'insulation tester',
    'indicator lamp', 'siren', 'annunciator', 'buzzer', 'search light', 'electricity', 'electrical',
    'automation', 'breaker', 'switch', 'sensor', 'transducer', 'thermostat', 'cable', 'generator',
    'alternator', 'diesel generator', 'starter battery', 'power supply unit',
    'abb', 'siemens', 'schneider', 'telemecanique', 'te connectivity', 'mitsubishi electric', 'honeywell',
    'pepperl fuchs', 'turck', 'ifm', 'sick', 'omron', 'allen bradley', 'ge frico', 'wago', 'phoenix contact',
    'kirloskar electric', 'crompton', 'prysmian', 'kohler', 'onan generator', ' relay',
  ] },
  { slug: 'ship-machinery', keywords: [
    'purifier', 'centrifuge', 'separator', 'oil water separator', 'oily water separator', 'fresh water generator',
    'fresh water plant', 'evaporator', 'refrigeration plant', 'refrigeration', 'air conditioning', 'compressor',
    'air compressor', 'refrigerant compressor', 'marine compressor', 'sperre', 'tanabe', 'steering gear',
    'incinerator', 'sewage treatment', 'reverse osmosis', 'boiler spare', 'heat exchanger', 'plate cooler',
    'plate type cooler', 'plate heat exchanger', 'shell tube', 'cargo heating', 'deck compressor',
    'marine chiller', 'chiller', 'steam turbine', 'gas turbine', 'turbine parts', 'vibrator motor', 'machinery',
    'westfalia', 'alfa laval', 'gft', 'trident', 'marine air',
  ] },
  { slug: 'tools-equipment', keywords: [
    'welding machine', 'welding plant', 'welder', 'arc welder', 'mig welder', 'grinding machine', 'drill machine',
    'drilling machine', 'bench drill', 'band saw', 'lathe machine', 'milling machine', 'power tool',
    'impact wrench', 'hydraulic torque', 'press machine', 'pressure washer', 'measuring instrument',
    'dial gauge', 'vernier', 'caliper', 'micrometer', 'borescope', 'bore scope', 'torque multiplier',
    'torque gauge', 'spring balance', 'tool box', 'tool kit', 'tools', 'equipments', 'equipment',
    'multitester', 'coating thickness gauge', 'laser pointer', 'thermal imaging', 'endoscope',
    'hilti', 'makita', 'bosch tool',
  ] },
  { slug: 'hand-tools', keywords: [
    'spanner set', 'spanner', 'combination spanner', 'ring spanner', 'open end spanner', 'wrench', 'pipe wrench',
    'torque wrench', 'box wrench', 'socket wrench', 'socket set', 'ratchet handle', 'plier', 'screwdriver',
    'hammer', 'mallet', 'hacksaw', 'hacksaw frame', 'file', 'files', 'chisel', 'punch', 'scraper', 'allen key',
    'hex key', 'tin snips', 'wire cutter', 'crimping tool', 'reamer', 'tap and die', 'die set', 'threading tool',
    'hand tool', 'handtools', 'puller', 'bearing puller', 'grease gun', 'riveter', 'clamp', 'shovel',
    'crow bar', 'crowbar', 'stanley', 'stahlwille', 'gedore', 'facom', 'koken', 'knipex', 'venus',
  ] },
  { slug: 'marine', keywords: [
    'marine hardware', 'boat hardware', 'nautical', 'ship horn', 'tyfon', 'marine', 'boat', 'ship bell',
    'ship lamp', 'anchor', 'flags',
  ] },
  { slug: 'surplus', keywords: ['surplus', 'used stock', 'liquidated', 'discontinued stock'] },
  { slug: 'spares', keywords: ['spare', 'spares', 'replacement part', 'compatible part'] },
  { slug: 'ship-navigation', keywords: ['bridge equipment'] },
]

// ─── Phase 1: eBay category-ID pins ────────────────────────────

/** Phase-3 matcher, precompiled once at module load. */
const COMPILED_KEYWORD_RULES: CompiledKeyword[] = CATEGORY_KEYWORD_RULES.flatMap((rule) =>
  rule.keywords
    .map((keyword) => compileKeyword(rule.slug, keyword))
    .filter((entry): entry is CompiledKeyword => entry !== null),
)

/**
 * Optional, environment-provided pin map for leaf categories that keyword
 * rules cannot disambiguate: `EBAY_CATEGORY_ID_MAP={"29506":"engine-parts"}`.
 * Pinned IDs always win over names and keywords; invalid entries warn and are
 * dropped. Built once at module load.
 */
const categoryEnvIdMap: Map<string, string> = (() => {
  const map = new Map<string, string>()
  const raw = String(process.env.EBAY_CATEGORY_ID_MAP || '')
  if (!raw) return map
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [id, slug] of Object.entries(parsed)) {
      const clean = String(slug || '').trim()
      if (id && isWebsiteCategorySlug(clean)) map.set(String(id), clean)
      else if (id) console.warn(`[ebayCategoryMapping] EBAY_CATEGORY_ID_MAP ignored entry "${id}" → "${slug}" (unknown website slug)`)
    }
  } catch (error) {
    console.warn(`[ebayCategoryMapping] EBAY_CATEGORY_ID_MAP is not valid JSON: ${(error as Error).message}`)
  }
  return map
})()

// ─── Resolution ────────────────────────────────────────────────

function buildSpecificsText(specifics?: CategorySourceInput['specifics']): string {
  if (!specifics?.length) return ''
  return normalizeCategoryText(specifics.map((spec) => `${spec.name} ${spec.value}`).join(' '))
}

function aliasHit(normalizedCategoryName: string): { slug: string; alias: string } | null {
  for (const entry of CATEGORY_ALIASES) {
    for (const alias of entry.aliases) {
      if (containsPhrase(normalizedCategoryName, alias)) return { slug: entry.slug, alias }
    }
  }
  return null
}

function containsPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeCategoryText(phrase)
  if (!normalizedPhrase) return false
  return new RegExp(`(^| )${escapeRegex(normalizedPhrase)}( |$)`).test(normalizedText)
}

/**
 * Resolve the website category for one listing/product. Never throws and
 * never returns null: confident matches are exactly pins, category-name
 * aliases, then keyword evidence, and anything unresolvable falls back to
 * 'other-business'.
 */
export function resolveWebsiteCategory(input: CategorySourceInput = {}): CategoryAssignment {
  const { categoryId, categoryName, title, specifics } = input
  const normalizedCategoryName = normalizeCategoryText(categoryName || '')
  const normalizedTitle = normalizeCategoryText(title || '')
  const specificsText = buildSpecificsText(specifics)

  // 1. Pinned eBay category ID (env override) — deterministic.
  if (categoryId && categoryEnvIdMap.has(String(categoryId))) {
    const slug = categoryEnvIdMap.get(String(categoryId))!
    return { slug, confidence: 'ebay-category-id', reason: `EBAY_CATEGORY_ID_MAP pin ${categoryId} → ${slug}` }
  }

  // 2. Phrase alias on the eBay category name (store mirror names, common
  //    taxonomy leaf names), then keyword aliases on the category name.
  if (normalizedCategoryName) {
    const alias = aliasHit(normalizedCategoryName)
    if (alias) return { slug: alias.slug, confidence: 'ebay-category', reason: `eBay category name "${categoryName}" → alias "${alias.alias}" → ${alias.slug}` }

    for (const rule of CATEGORY_NAME_KEYWORD_RULES) {
      for (const keyword of rule.keywords) {
        if (containsPhrase(normalizedCategoryName, keyword)) {
          return {
            slug: rule.slug,
            confidence: 'ebay-category',
            reason: `eBay category name "${categoryName}" → keyword alias "${keyword}" → ${rule.slug}`,
          }
        }
      }
    }
  }

  // 3. Content keywords on the title, then item specifics.
  for (const [label, text] of [['title', normalizedTitle], ['item specifics', specificsText]] as const) {
    if (!text) continue
    for (const compiled of COMPILED_KEYWORD_RULES) {
      if (matches(text, compiled)) {
        return {
          slug: compiled.slug,
          confidence: 'keyword',
          reason: `${label} keyword "${compiled.keyword}" → ${compiled.slug}`,
        }
      }
    }
  }

  // 4. Sensible catch-all so category filters / the publish gate never hit NULL.
  return {
    slug: FALLBACK_CATEGORY_SLUG,
    confidence: 'fallback',
    reason: `no confident match from eBay category "${categoryName || ''}" or content keywords → fallback ${FALLBACK_CATEGORY_SLUG}`,
  }
}

/**
 * Import-side helper: return the Category row id for the resolved slug from
 * the live website category table; when the website does not have that
 * category (renamed/deleted row) fall to the fallback slug — and when even
 * the fallback is missing, NULL so the draft stays behind the publish gate.
 */
export function categoryIdForSlug(
  slug: string,
  categories: Array<{ id: string; slug?: string | null; name: string }>,
): string | null {
  const bySlug = (wanted: string) => categories.find((category) => category.slug === wanted)?.id
  return bySlug(slug) ?? bySlug(FALLBACK_CATEGORY_SLUG) ?? null
}
