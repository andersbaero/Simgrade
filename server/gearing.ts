// Builds candidate gear sets and decides their gems and enchants.
//
// Stat accounting mirrors sim/core/database.go exactly:
//   item stats + randomSuffix * randPropPoints/10000 (floored)
//            + enchant + gems + socket bonus (only when every socket matches)
// so the hit rating we solve against is the hit rating the sim will see.

import { GemColor, gemEligibleForSocket, gemMatchesSocket, ItemSlot, ItemSpec, ItemType } from '../shared/wow.js';
import { Config, SOCKET_COLOR_OF, SocketKey } from './config.js';
import { addStats, ItemDatabase, RawItem, StatMap } from './itemDb.js';
import { isMetaGemActive, MetaColorKey, metaDeficit, metaGemConditionDescription } from './metaGems.js';

export type Gear = (ItemSpec | null)[];

export interface GemChange {
	slot: ItemSlot;
	socketIndex: number;
	fromGemId: number;
	toGemId: number;
	description: string;
}

export interface GemPolicyResult {
	gear: Gear;
	changes: GemChange[];
	hitRating: number;
	notes: string[];
	warnings: string[];
}

const socketKeyOf = (color: GemColor): SocketKey | null => {
	switch (color) {
		case GemColor.Red:
			return 'red';
		case GemColor.Yellow:
			return 'yellow';
		case GemColor.Blue:
			return 'blue';
		case GemColor.Prismatic:
			return 'prismatic';
		default:
			return null;
	}
};

export function cloneGear(gear: Gear): Gear {
	return gear.map(item => (item ? { ...item, gems: item.gems ? [...item.gems] : undefined } : null));
}

/** Stats contributed by one equipped item, matching ItemEquipmentBaseStats + GemAndEnchantStats. */
export function itemStats(db: ItemDatabase, spec: ItemSpec): StatMap {
	const item = db.item(spec.id);
	if (!item) return {};

	const out: StatMap = {};
	addStats(out, db.itemStats(item));

	if (spec.randomSuffix) {
		const randPropPoints = db.scaling(item).randPropPoints ?? 0;
		const suffix = db.randomSuffixStats(spec.randomSuffix);
		for (const [stat, value] of Object.entries(suffix)) {
			out[Number(stat)] = (out[Number(stat)] ?? 0) + Math.floor((value * randPropPoints) / 10000);
		}
	}

	if (spec.enchant) addStats(out, db.enchantStats(spec.enchant));

	const gems = spec.gems ?? [];
	for (const gemId of gems) if (gemId) addStats(out, db.gemStats(gemId));

	if (hasSocketBonus(db, item, gems)) addStats(out, db.socketBonusStats(item));
	return out;
}

export function hasSocketBonus(db: ItemDatabase, item: RawItem, gems: number[]): boolean {
	const sockets = db.sockets(item);
	if (sockets.length === 0 || gems.length < sockets.length) return false;
	return sockets.every((socketColor, idx) => {
		const gem = db.gem(gems[idx] ?? 0);
		return !!gem && gemMatchesSocket((gem.color ?? 0) as GemColor, socketColor);
	});
}

export function gearStats(db: ItemDatabase, gear: Gear): StatMap {
	const out: StatMap = {};
	for (const spec of gear) if (spec) addStats(out, itemStats(db, spec));
	return out;
}

export function gearHitRating(db: ItemDatabase, gear: Gear, hitStatIdx: number): number {
	return gearStats(db, gear)[hitStatIdx] ?? 0;
}

/** Every non-meta gem currently socketed, as colours, for meta activation checks. */
function allGemColors(db: ItemDatabase, gear: Gear): GemColor[] {
	const colors: GemColor[] = [];
	for (const spec of gear) {
		for (const gemId of spec?.gems ?? []) {
			if (!gemId) continue;
			const gem = db.gem(gemId);
			if (gem && gem.color !== GemColor.Meta) colors.push((gem.color ?? 0) as GemColor);
		}
	}
	return colors;
}

function equippedMetaGemId(db: ItemDatabase, gear: Gear): number {
	for (const spec of gear) {
		for (const gemId of spec?.gems ?? []) {
			if (gemId && db.gem(gemId)?.color === GemColor.Meta) return gemId;
		}
	}
	return 0;
}

export function metaGemActive(db: ItemDatabase, gear: Gear): { metaGemId: number; active: boolean; requirement: string } {
	const metaGemId = equippedMetaGemId(db, gear);
	if (!metaGemId) return { metaGemId: 0, active: true, requirement: '' };
	return {
		metaGemId,
		active: isMetaGemActive(metaGemId, allGemColors(db, gear)),
		requirement: metaGemConditionDescription(metaGemId),
	};
}

interface Socket {
	slot: ItemSlot;
	socketIndex: number;
	color: GemColor;
	key: SocketKey;
}

function listSockets(db: ItemDatabase, gear: Gear): Socket[] {
	const out: Socket[] = [];
	gear.forEach((spec, slot) => {
		if (!spec) return;
		const item = db.item(spec.id);
		if (!item) return;
		db.sockets(item).forEach((color, socketIndex) => {
			const key = socketKeyOf(color);
			if (key) out.push({ slot: slot as ItemSlot, socketIndex, color, key });
		});
	});
	return out;
}

const gemName = (db: ItemDatabase, id: number) => db.gem(id)?.name ?? (id ? `gem ${id}` : 'empty');

function setGem(gear: Gear, socket: Socket, gemId: number): void {
	const spec = gear[socket.slot];
	if (!spec) return;
	const gems = spec.gems ? [...spec.gems] : [];
	while (gems.length <= socket.socketIndex) gems.push(0);
	gems[socket.socketIndex] = gemId;
	spec.gems = gems;
}

const getGem = (gear: Gear, socket: Socket): number => gear[socket.slot]?.gems?.[socket.socketIndex] ?? 0;

/**
 * Fills empty sockets with the configured normal gem, then trades gems between
 * the "normal" and "hit" choices so total gear hit lands as close to the target
 * as possible without going under it — never deactivating the meta gem.
 */
export function applyGemPolicy(
	db: ItemDatabase,
	inputGear: Gear,
	config: Config,
	hitStatIdx: number,
	targetHitRating: number,
): GemPolicyResult {
	const gear = cloneGear(inputGear);
	const changes: GemChange[] = [];
	const notes: string[] = [];
	const warnings: string[] = [];
	const hitOf = (gemId: number) => (gemId ? (db.gemStats(gemId)[hitStatIdx] ?? 0) : 0);

	// A socket colour with no configured gem borrows another colour's gem rather
	// than being left empty.
	const fallbackGem = (key: SocketKey): { gemId: number; borrowed: boolean } => {
		const own = config.gems.normal[key];
		if (own) return { gemId: own, borrowed: false };
		for (const alt of ['red', 'yellow', 'blue', 'prismatic'] as SocketKey[]) {
			if (config.gems.normal[alt]) return { gemId: config.gems.normal[alt], borrowed: true };
		}
		return { gemId: 0, borrowed: false };
	};

	/** Meta gems only fit meta sockets; every other colour fits any other socket. */
	const canPlace = (gemId: number, socketColor: GemColor): boolean => {
		const color = (db.gem(gemId)?.color ?? GemColor.Unknown) as GemColor;
		return gemEligibleForSocket(color, socketColor);
	};

	// 1. Fill any empty socket (a freshly equipped item has none socketed).
	for (const socket of listSockets(db, gear)) {
		if (getGem(gear, socket)) continue;
		const { gemId: fill, borrowed } = fallbackGem(socket.key);
		if (!fill) {
			warnings.push(`No ${socket.key} gem configured — left an empty socket on ${slotLabel(socket.slot)}.`);
			continue;
		}
		if (!canPlace(fill, socket.color)) {
			warnings.push(`${gemName(db, fill)} cannot go in a ${socket.key} socket — left the socket on ${slotLabel(socket.slot)} empty.`);
			continue;
		}
		if (borrowed) {
			warnings.push(`No ${socket.key} gem configured — used your ${gemName(db, fill)} in the ${socket.key} socket on ${slotLabel(socket.slot)}.`);
		}
		setGem(gear, socket, fill);
		changes.push({
			slot: socket.slot,
			socketIndex: socket.socketIndex,
			fromGemId: 0,
			toGemId: fill,
			description: `${slotLabel(socket.slot)}: socketed ${gemName(db, fill)}`,
		});
	}

	// Meta sockets are separate: a new helm arrives without one.
	for (const [slot, spec] of gear.entries()) {
		if (!spec) continue;
		const item = db.item(spec.id);
		if (!item) continue;
		db.sockets(item).forEach((color, socketIndex) => {
			if (color !== GemColor.Meta) return;
			const socket: Socket = { slot: slot as ItemSlot, socketIndex, color, key: 'prismatic' };
			if (getGem(gear, socket)) return;
			if (!config.gems.meta) {
				warnings.push(`No meta gem configured — left the meta socket on ${slotLabel(slot as ItemSlot)} empty.`);
				return;
			}
			if (!canPlace(config.gems.meta, GemColor.Meta)) {
				warnings.push(`${gemName(db, config.gems.meta)} is not a meta gem — left the meta socket on ${slotLabel(slot as ItemSlot)} empty.`);
				return;
			}
			setGem(gear, socket, config.gems.meta);
			changes.push({
				slot: slot as ItemSlot,
				socketIndex,
				fromGemId: 0,
				toGemId: config.gems.meta,
				description: `${slotLabel(slot as ItemSlot)}: socketed ${gemName(db, config.gems.meta)}`,
			});
		});
	}

	// 1c. Force the meta gem's requirements to be met, even when the gear has no
	// socket of the colour it wants. An inactive meta gem is a flat loss of its
	// whole stat line, which is worth far more than the socket bonus given up by
	// putting an off-colour gem in. The gem used is whatever is configured for
	// that colour in the gem settings.
	const forceMetaColors = () => {
		const metaGemId = equippedMetaGemId(db, gear);
		if (!metaGemId || isMetaGemActive(metaGemId, allGemColors(db, gear))) return;

		const requirement = metaGemConditionDescription(metaGemId);
		// Bounded by the number of sockets: every pass fills one.
		for (let pass = listSockets(db, gear).length; pass > 0; pass--) {
			if (isMetaGemActive(metaGemId, allGemColors(db, gear))) return;

			const deficit = metaDeficit(metaGemId, allGemColors(db, gear));
			const needed = (['blue', 'red', 'yellow'] as MetaColorKey[])
				.filter(key => deficit[key] > 0)
				.sort((a, b) => deficit[b] - deficit[a])[0];
			if (!needed) return;

			const gemId = config.gems.normal[needed];
			if (!gemId) {
				warnings.push(`Meta gem ${gemName(db, metaGemId)} needs ${deficit[needed]} more ${needed} gem(s), but no ${needed} gem is configured.`);
				return;
			}

			// The configured gem has to actually count as that colour — a red gem
			// chosen for the blue socket will never satisfy a blue requirement.
			const gemColor = (db.gem(gemId)?.color ?? GemColor.Unknown) as GemColor;
			if (!gemMatchesSocket(gemColor, SOCKET_COLOR_OF[needed])) {
				warnings.push(
					`Meta gem ${gemName(db, metaGemId)} needs a ${needed} gem, but the configured ${needed} gem (${gemName(db, gemId)}) does not count as ${needed}.`,
				);
				return;
			}

			const socket = pickSocketToSacrifice(needed, gemId);
			if (!socket) {
				warnings.push(`Meta gem ${gemName(db, metaGemId)} is NOT active — no socket left to force a ${needed} gem into. ${requirement}`);
				return;
			}

			const from = getGem(gear, socket);
			setGem(gear, socket, gemId);
			changes.push({
				slot: socket.slot,
				socketIndex: socket.socketIndex,
				fromGemId: from,
				toGemId: gemId,
				description: `${slotLabel(socket.slot)}: ${gemName(db, from)} → ${gemName(db, gemId)} (forced ${needed} for ${gemName(db, metaGemId)})`,
			});
		}
	};

	/**
	 * The cheapest socket to give up for a meta colour: one whose item has no
	 * socket bonus at all, then one whose bonus is already lost, and only then a
	 * socket that still earns one. Sockets already counting toward the colour are
	 * useless here, and hit gems are left alone where possible.
	 */
	const pickSocketToSacrifice = (needed: MetaColorKey, gemId: number): Socket | null => {
		const wanted = SOCKET_COLOR_OF[needed];
		const candidates = listSockets(db, gear).filter(socket => {
			const current = getGem(gear, socket);
			if (current === gemId) return false;
			const currentColor = (db.gem(current)?.color ?? GemColor.Unknown) as GemColor;
			// Replacing a gem that already counts would not change the tally.
			return !gemMatchesSocket(currentColor, wanted);
		});

		const cost = (socket: Socket): number => {
			const item = db.item(gear[socket.slot]!.id)!;
			const hasBonus = Object.keys(db.socketBonusStats(item)).length > 0;
			if (!hasBonus) return 0;
			if (!hasSocketBonus(db, item, gear[socket.slot]!.gems ?? [])) return 1;
			return 2;
		};

		return (
			candidates.sort((a, b) => {
				const byCost = cost(a) - cost(b);
				if (byCost !== 0) return byCost;
				// Prefer displacing a plain gem over one carrying hit.
				const isHit = (socket: Socket) => (getGem(gear, socket) === config.gems.hit[socket.key] ? 1 : 0);
				return isHit(a) - isHit(b) || a.slot - b.slot || a.socketIndex - b.socketIndex;
			})[0] ?? null
		);
	};

	forceMetaColors();

	// 2. Order sockets by the configured swap priority so the choice is deterministic.
	const priority = new Map(config.hitSwapPriority.map((key, idx) => [key, idx]));
	const ordered = listSockets(db, gear).sort(
		(a, b) => (priority.get(a.key) ?? 99) - (priority.get(b.key) ?? 99) || a.slot - b.slot || a.socketIndex - b.socketIndex,
	);

	const metaBefore = metaGemActive(db, gear);
	const trySwap = (socket: Socket, toGemId: number): boolean => {
		if (!canPlace(toGemId, socket.color)) return false;
		const from = getGem(gear, socket);
		setGem(gear, socket, toGemId);
		// Only block a swap that breaks a meta gem that was working beforehand.
		if (metaBefore.active && !metaGemActive(db, gear).active) {
			setGem(gear, socket, from);
			return false;
		}
		changes.push({
			slot: socket.slot,
			socketIndex: socket.socketIndex,
			fromGemId: from,
			toGemId,
			description: `${slotLabel(socket.slot)}: ${gemName(db, from)} → ${gemName(db, toGemId)}`,
		});
		return true;
	};

	let hit = gearHitRating(db, gear, hitStatIdx);
	let blockedByMeta = false;

	// 2a. Short of the target: upgrade normal gems to hit gems.
	for (const socket of ordered) {
		if (hit >= targetHitRating) break;
		const normalGem = config.gems.normal[socket.key];
		const hitGem = config.gems.hit[socket.key];
		if (!hitGem || !normalGem || getGem(gear, socket) !== normalGem) continue;
		if (hitOf(hitGem) <= hitOf(normalGem)) continue;
		if (trySwap(socket, hitGem)) hit = gearHitRating(db, gear, hitStatIdx);
		else blockedByMeta = true;
	}

	// 2b. Over the target: reclaim hit gems for normal ones while staying at or above it.
	for (const socket of [...ordered].reverse()) {
		const normalGem = config.gems.normal[socket.key];
		const hitGem = config.gems.hit[socket.key];
		if (!hitGem || !normalGem || getGem(gear, socket) !== hitGem) continue;
		const surplus = hit - targetHitRating;
		if (surplus < hitOf(hitGem) - hitOf(normalGem)) continue;
		if (trySwap(socket, normalGem)) hit = gearHitRating(db, gear, hitStatIdx);
		else blockedByMeta = true;
	}

	if (hit < targetHitRating) {
		const short = Math.round(targetHitRating - hit);
		notes.push(
			blockedByMeta
				? `${short} hit rating short of target — no further gem swaps were possible without deactivating the meta gem.`
				: `${short} hit rating short of target — ran out of sockets holding a swappable gem.`,
		);
	}

	const meta = metaGemActive(db, gear);
	if (meta.metaGemId && !meta.active) {
		warnings.push(`Meta gem ${gemName(db, meta.metaGemId)} is NOT active. ${meta.requirement}`);
	}

	// An off-colour gem is a legitimate choice, but it costs the socket bonus.
	// Say which items lost one so the trade-off is visible rather than silent.
	const forfeited = gear
		.map((spec, slot) => ({ spec, slot: slot as ItemSlot }))
		.filter(({ spec }) => {
			if (!spec) return false;
			const item = db.item(spec.id);
			return !!item && db.sockets(item).length > 0 && Object.keys(db.socketBonusStats(item)).length > 0;
		})
		.filter(({ spec }) => !hasSocketBonus(db, db.item(spec!.id)!, spec!.gems ?? []))
		.map(({ slot }) => slotLabel(slot));
	if (forfeited.length) notes.push(`Socket bonus not earned on ${forfeited.join(', ')} (off-colour gems).`);

	return { gear, changes, hitRating: hit, notes, warnings };
}

export function slotLabel(slot: ItemSlot): string {
	return (
		{
			[ItemSlot.Head]: 'Head',
			[ItemSlot.Neck]: 'Neck',
			[ItemSlot.Shoulder]: 'Shoulder',
			[ItemSlot.Back]: 'Back',
			[ItemSlot.Chest]: 'Chest',
			[ItemSlot.Wrist]: 'Wrist',
			[ItemSlot.Hands]: 'Hands',
			[ItemSlot.Waist]: 'Waist',
			[ItemSlot.Legs]: 'Legs',
			[ItemSlot.Feet]: 'Feet',
			[ItemSlot.Finger1]: 'Ring 1',
			[ItemSlot.Finger2]: 'Ring 2',
			[ItemSlot.Trinket1]: 'Trinket 1',
			[ItemSlot.Trinket2]: 'Trinket 2',
			[ItemSlot.MainHand]: 'Main Hand',
			[ItemSlot.OffHand]: 'Off Hand',
			[ItemSlot.Ranged]: 'Ranged',
		}[slot] ?? `Slot ${slot}`
	);
}

/** Enchant carried over from the item being replaced, when it still applies. */
export function chooseEnchant(db: ItemDatabase, newItem: RawItem, replaced: ItemSpec | null, config: Config, slot: ItemSlot): number {
	const candidates = [replaced?.enchant, config.defaultEnchants[slot]].filter((id): id is number => !!id);
	for (const effectId of candidates) {
		if (enchantApplies(db, effectId, newItem)) return effectId;
	}
	return 0;
}

/** Port of enchantAppliesToItem() from ui/core/proto_utils/utils.ts. */
export function enchantApplies(db: ItemDatabase, effectId: number, item: RawItem): boolean {
	const enchant = db.enchant(effectId);
	if (!enchant) return false;

	const enchantTypes = [enchant.type ?? 0, ...(enchant.extraTypes ?? [])];
	const itemType = item.type ?? 0;
	const matchesType = enchantTypes.some(type => type === itemType || (type === ItemType.Weapon && itemType === ItemType.Weapon));
	if (!matchesType) return false;

	const EnchantTypeTwoHand = 1;
	const EnchantTypeShield = 2;
	const EnchantTypeStaff = 4;
	const EnchantTypeOffHand = 5;
	const WeaponTypeOffHand = 5;
	const WeaponTypeShield = 7;
	const WeaponTypeStaff = 8;
	const HandTypeTwoHand = 4;

	const enchantType = enchant.enchantType ?? 0;
	if (enchantType === EnchantTypeTwoHand && item.handType !== HandTypeTwoHand) return false;
	if (enchantType === EnchantTypeStaff && item.weaponType !== WeaponTypeStaff) return false;
	if (enchantType === EnchantTypeShield && item.weaponType !== WeaponTypeShield) return false;

	if (itemType === ItemType.Weapon) {
		const itemIsOffHandOnly =
			item.weaponType === WeaponTypeOffHand || (item.weaponType === WeaponTypeShield && enchantType !== EnchantTypeShield);
		if ((enchantType === EnchantTypeOffHand) !== itemIsOffHandOnly) return false;
	}

	if (item.rangedWeaponType && item.rangedWeaponType !== 5 && (enchant.type ?? 0) !== ItemType.Ranged) return false;
	return true;
}

export function describeGemChanges(changes: GemChange[]): string[] {
	return changes.map(change => change.description);
}