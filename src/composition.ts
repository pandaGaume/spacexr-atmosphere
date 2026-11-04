import { gases } from "./molecular";
import type { GasMixture, GasSpecies, IMixtureOptics } from "./molecular";
/** Structural gas metadata compatible with spikypanda-core, with SI properties. */
export interface IGasMetadata {
    /** Stable chemical species identifier. */
    readonly speciesId: string;
    /** Human-readable name. */
    readonly displayName: string;
    /** Molar mass, kilograms per mole. */
    readonly molarMass: number;
    /** Material density at reference conditions, kilograms per cubic metre. */
    readonly density?: number;
    /** Specific heat, J per kg per kelvin. */
    readonly specificHeat?: number;
    /** Thermal conductivity, W per metre per kelvin. */
    readonly thermalConductivity?: number;
    /** Dynamic viscosity, pascal seconds. */
    readonly viscosity?: number;
    /** CAS identifier. */
    readonly casNumber?: string;
    /** Empirical formula. */
    readonly formula?: string;
    /** Eight-hour exposure threshold, ppm. No optical effect. */
    readonly oelTwa?: number;
    /** Short-term exposure threshold, ppm. No optical effect. */
    readonly oelStel?: number;
    /** Immediately dangerous exposure threshold, ppm. No optical effect. */
    readonly idlh?: number;
    /** Hazard classification, metadata only. */
    readonly hazardClass?: string;
}
/** Composition component shape from spikypanda Chemistry.Composition. */
export interface ICompositionComponent {
    /** Stable chemical species identifier. */
    readonly speciesId: string;
    /** Nonnegative relative molar fraction. */
    readonly moleFraction: number;
    /** Molar mass, kilograms per mole, authoritative for this component. */
    readonly molarMass: number;
    /** Optional graph provenance, not used by optical calculations. */
    readonly gasItemId?: string;
}
/** Particulate shape from spikypanda-core. Metadata alone is insufficient to run optical Mie calculations. */
export interface IParticulateMetadata {
    /** Stable particulate identifier. */
    readonly particulateId: string;
    /** Human-readable label. */
    readonly displayName: string;
    /** Median aerodynamic diameter, metres; must not be silently treated as an optical sphere diameter. */
    readonly characteristicDiameter?: number;
    /** Bulk material density, kilograms per cubic metre. */
    readonly density?: number;
    /** Opaque particulate category; no predefined optical color. */
    readonly pmClass?: string;
}
/** Structural snapshot of spikypanda's ICompositionView, independent from its editor and simulation runtime. */
export interface ICompositionView {
    /** Species inventory and molar fractions. */
    readonly components: readonly ICompositionComponent[];
    /** Total reference pressure, pascals. */
    readonly referencePressurePa: number;
    /** Bound particulate metadata. Optical parameters are supplied separately by particulate id. */
    readonly particulates: readonly IParticulateMetadata[];
}
/** Optional optical property for a species outside the built-in registry. */
export interface IMolecularOpticalProperty {
    /** Static polarizability volume, cubic angstroms. */
    readonly polarizabilityAngstrom3: number;
}
/** Resolves scalar physical data for arbitrary known species ids, never from expected sky color. */
export type MolecularOpticalRegistry = Readonly<Record<string, IMolecularOpticalProperty>>;
/** Converts the legacy molar-fraction shorthand to the structural composition contract. */
export function compositionFromMixture(
    mixture: GasMixture,
    pressurePa: number,
    particulates: readonly IParticulateMetadata[] = [],
): ICompositionView {
    return copyComposition({
        referencePressurePa: pressurePa,
        particulates,
        components: Object.entries(mixture).map(([speciesId, moleFraction]) => ({
            speciesId,
            moleFraction,
            molarMass: gases[speciesId as GasSpecies].mass / 1000,
        })),
    });
}
/** Validates and copies a composition without assuming a particular concrete graph-node class. */
export function copyComposition(value: ICompositionView): ICompositionView {
    if (!Number.isFinite(value.referencePressurePa) || value.referencePressurePa < 0)
        throw new Error("Invalid composition reference pressure");
    const ids = new Set<string>();
    for (const c of value.components) {
        if (
            !c.speciesId.trim() ||
            !Number.isFinite(c.moleFraction) ||
            c.moleFraction < 0 ||
            !Number.isFinite(c.molarMass) ||
            c.molarMass <= 0 ||
            ids.has(c.speciesId)
        )
            throw new Error("Invalid or duplicate composition component");
        ids.add(c.speciesId);
    }
    for (const p of value.particulates) {
        if (
            !p.particulateId.trim() ||
            !p.displayName ||
            (p.characteristicDiameter !== undefined && !(p.characteristicDiameter > 0 && Number.isFinite(p.characteristicDiameter))) ||
            (p.density !== undefined && !(p.density > 0 && Number.isFinite(p.density)))
        )
            throw new Error("Invalid particulate metadata");
    }
    return Object.freeze({
        referencePressurePa: value.referencePressurePa,
        components: Object.freeze(value.components.map((c) => Object.freeze({ ...c }))),
        particulates: Object.freeze(value.particulates.map((p) => Object.freeze({ ...p }))),
    });
}
/** Computes molecular optical coefficients using composition-owned SI molar masses and explicit optical metadata. */
export function compositionOptics(
    composition: ICompositionView,
    temperatureK: number,
    gravity: number,
    wavelengthNm: number,
    registry: MolecularOpticalRegistry = {},
): IMixtureOptics {
    if (!(temperatureK > 0 && gravity > 0 && wavelengthNm > 0 && [temperatureK, gravity, wavelengthNm].every(Number.isFinite)))
        throw new Error("Invalid composition thermodynamic state");
    const sum = composition.components.reduce((s, c) => s + c.moleFraction, 0);
    if (sum === 0 && composition.referencePressurePa === 0) return { beta: 0, meanMassAmu: 0, scaleHeight: 1 };
    if (!(sum > 0)) throw new Error("Nonvacuum composition requires positive molar fractions");
    let mass = 0,
        alpha2 = 0;
    for (const c of composition.components) {
        if (c.moleFraction === 0) continue;
        const optical = registry[c.speciesId]?.polarizabilityAngstrom3 ?? gases[c.speciesId as GasSpecies]?.alpha;
        if (!(optical >= 0 && Number.isFinite(optical))) throw new Error(`Missing molecular optical property for ${c.speciesId}`);
        mass += (c.moleFraction / sum) * c.molarMass;
        alpha2 += (c.moleFraction / sum) * (optical * 1e-30) ** 2;
    }
    return {
        beta:
            (composition.referencePressurePa / (1.380649e-23 * temperatureK)) *
            ((8 * Math.PI) / 3) *
            ((2 * Math.PI) / (wavelengthNm * 1e-9)) ** 4 *
            alpha2,
        scaleHeight: (8.31446261815324 * temperatureK) / (mass * gravity),
        meanMassAmu: mass * 1000,
    };
}
