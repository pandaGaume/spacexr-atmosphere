/** Supported molecular constituents of the visible-light static polarizability approximation. */
export type GasSpecies = "N2" | "O2" | "CO2" | "Ar" | "H2O";
/** Nonnegative relative molar fractions, normalized jointly by the optical solver. */
export type GasMixture = Partial<Record<GasSpecies, number>>;
/** Molecular properties taken from the original documented physical model. */
export interface IGasProperties {
    /** Molecular mass, atomic mass units. */
    readonly mass: number;
    /** Static polarizability volume, cubic angstroms. */
    readonly alpha: number;
}
/** Derived molecular scattering and hydrostatic profile. */
export interface IMixtureOptics {
    /** Zero-altitude Rayleigh coefficient, inverse metres. */
    readonly beta: number;
    /** Isothermal hydrostatic height, metres. */
    readonly scaleHeight: number;
    /** Molar-fraction weighted molecular mass, atomic mass units. */
    readonly meanMassAmu: number;
}
// Polarizability volumes in A^3, experimental NIST CCCBDB values. Static approximation.
/** Static molecular mass and polarizability data, no planet-specific sky colors. */
export const gases: Readonly<Record<GasSpecies, IGasProperties>> = Object.freeze({
    N2: { mass: 28.0134, alpha: 1.71 },
    O2: { mass: 31.998, alpha: 1.562 },
    CO2: { mass: 44.01, alpha: 2.507 },
    Ar: { mass: 39.948, alpha: 1.664 },
    H2O: { mass: 18.01528, alpha: 1.501 },
});
/** Rayleigh scattering at a wavelength in nm, from pressure in Pa and temperature in K. */
export function mixtureOptics(
    mix: GasMixture,
    pressure: number,
    temperature: number,
    gravity: number,
    wavelengthNm: number,
): IMixtureOptics {
    const entries = Object.entries(mix) as [GasSpecies, number][];
    if (entries.some(([gas, x]) => !gases[gas] || !Number.isFinite(x) || x < 0)) throw new Error("Invalid molecular mixture");
    const sum = entries.reduce((s, [, x]) => s + x, 0);
    if (!(
        sum > 0 &&
        pressure >= 0 &&
        Number.isFinite(pressure) &&
        temperature > 0 &&
        gravity > 0 &&
        wavelengthNm > 0 &&
        [temperature, gravity, wavelengthNm].every(Number.isFinite)
    ))
        throw new Error("Invalid gas state");
    const mass = entries.reduce((s, [g, x]) => s + (x / sum) * gases[g].mass, 0);
    const polarizabilitySquared = entries.reduce((s, [g, x]) => s + (x / sum) * (gases[g].alpha * 1e-30) ** 2, 0);
    // sigma = (8*pi/3) * (2*pi/lambda)^4 * alpha_volume^2.
    const crossSection = ((8 * Math.PI) / 3) * ((2 * Math.PI) / (wavelengthNm * 1e-9)) ** 4 * polarizabilitySquared;
    return {
        beta: (pressure / (1.380649e-23 * temperature)) * crossSection,
        scaleHeight: (1.380649e-23 * temperature) / (mass * 1.6605390666e-27 * gravity),
        meanMassAmu: mass,
    };
}
