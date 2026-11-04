import { copyComposition } from "./composition";
import type { ICompositionView, IParticulateMetadata } from "./composition";
/** Data-only composition preset compatible with the spikypanda catalog. */
export interface ICompositionPreset extends ICompositionView {
    /** Stable preset id used by Chemistry.Composition. */
    readonly presetId: string;
    /** Original graph node type id, preserved as provenance. */
    readonly typeId: string;
    /** Human-readable catalog label. */
    readonly displayName: string;
}
const masses: Readonly<Record<string, number>> = { N2: 0.0280134, O2: 0.0319988, CO2: 0.0440095, H2O: 0.01801528, Ar: 0.039948 };
function preset(
    presetId: string,
    typeId: string,
    displayName: string,
    referencePressurePa: number,
    fractions: Readonly<Record<string, number>>,
): ICompositionPreset {
    const view = copyComposition({
        referencePressurePa,
        components: Object.entries(fractions).map(([speciesId, moleFraction]) => ({
            speciesId,
            moleFraction,
            molarMass: masses[speciesId],
        })),
        particulates: [],
    });
    return Object.freeze({ ...view, presetId, typeId, displayName });
}
/** Earth humid-air composition copied as physical data from spikypanda's catalog. */
export const EARTH_HUMID_AIR_PRESET = preset(
    "earthHumidAirSeaLevel",
    "Chemistry.Composition:earth-humid-air",
    "Earth air, sea level (humid)",
    101325,
    { N2: 0.7715, O2: 0.2072, CO2: 0.00042, H2O: 0.0116, Ar: 0.00928 },
);
/** Earth dry-air composition from the same catalog. */
export const EARTH_DRY_AIR_PRESET = preset(
    "earthDryAirSeaLevel",
    "Chemistry.Composition:earth-dry-air",
    "Earth air, sea level (dry)",
    101325,
    { N2: 0.78084, O2: 0.20946, CO2: 0.00042, Ar: 0.00928 },
);
/** Mars mean composition and 600 Pa reference pressure from spikypanda. */
export const MARS_ATMOSPHERE_PRESET = preset("marsAtmosphereMean", "Chemistry.Composition:mars-atmosphere", "Mars atmosphere (mean)", 600, {
    CO2: 0.9532,
    N2: 0.027,
    Ar: 0.0163,
    O2: 0.0013,
    H2O: 0.0003,
});
/** ISS cabin composition from spikypanda, without any optical color preset. */
export const ISS_CABIN_PRESET = preset("issCabinECLSS", "Chemistry.Composition:iss-cabin", "ISS cabin (ECLSS spec)", 101325, {
    N2: 0.781,
    O2: 0.209,
    CO2: 0.003,
    H2O: 0.007,
});
/** Vacuum composition, with no molecules and zero reference pressure. */
export const VACUUM_PRESET = preset("vacuum", "Chemistry.Composition:vacuum", "Vacuum", 0, {});
/** Original five composition catalog entries, data-only and immutable. */
export const COMPOSITION_PRESETS: readonly ICompositionPreset[] = Object.freeze([
    EARTH_HUMID_AIR_PRESET,
    EARTH_DRY_AIR_PRESET,
    MARS_ATMOSPHERE_PRESET,
    ISS_CABIN_PRESET,
    VACUUM_PRESET,
]);
/** Original generic, PM2.5, PM10 and lunar-dust descriptors. These contain no invented optical constants. */
export const PARTICULATE_PRESETS: readonly IParticulateMetadata[] = Object.freeze([
    Object.freeze({ particulateId: "pm", displayName: "Particulate", characteristicDiameter: 1e-5, density: 1000, pmClass: "pm10" }),
    Object.freeze({ particulateId: "pm2_5", displayName: "PM2.5", characteristicDiameter: 2.5e-6, density: 1500, pmClass: "pm2_5" }),
    Object.freeze({ particulateId: "pm10", displayName: "PM10", characteristicDiameter: 1e-5, density: 1500, pmClass: "pm10" }),
    Object.freeze({ particulateId: "lunar_dust", displayName: "Lunar dust", characteristicDiameter: 5e-6, density: 3100, pmClass: "dust" }),
]);
