import { compositionFromMixture } from "./composition";
import { mixtureOptics } from "./molecular";
import type { GasMixture } from "./molecular";
export * from "./molecular";
import type { IEllipsoidAxes, Vector3 } from "./types";
import type { IDustOptions } from "./scattering";
/** Inputs for an ellipsoidal spectral atmosphere and its incident star. */
export interface IPhysicalAtmosphereConfig extends IDustOptions {
    /** Planet dimensions selector, unless an explicit ellipsoid is supplied. */
    planet?: "earth" | "mars";
    /** Optional independent layer definitions, replacing the two default gas and aerosol layers. */
    layers?: readonly IAtmosphereLayerDefinition[];
    /** Optional custom ellipsoid dimensions, metres. */
    ellipsoid?: IEllipsoidAxes;
    /** Surface pressure, pascals. */
    pressure?: number;
    /** Isothermal gas temperature, kelvins. */
    temperature?: number;
    /** Surface gravity, metres per squared second. */
    gravity?: number;
    /** Relative molecular fractions; omitted species have zero abundance. */
    mix?: GasMixture;
    /** Reference aerosol optical depth at 550 nm for the untruncated exponential profile. */
    dustTau?: number;
    /** Aerosol scale height, metres. */
    dustHeight?: number;
    /** Stellar distance, astronomical units. Stellar radius is held equal to the solar radius. */
    distanceAU?: number;
    /** Incident spectrum: Planck continuum or experimental Gaussian band. */
    source?: "blackbody" | "band";
    /** Blackbody temperature, kelvins. */
    starTemperature?: number;
    /** Experimental Gaussian band center, nanometres. */
    bandCenter?: number;
    /** Experimental Gaussian full width at half maximum, nanometres. */
    bandWidth?: number;
    /** Midpoint samples over 380 to 780 nm; supported values 24 and 48. */
    wavelengths?: 24 | 48;
}
/** One resolved wavelength sample with optical and observer coefficients. */
export interface ISpectralBin {
    /** Midpoint wavelength, nanometres. */
    readonly wavelengthNm: number;
    /** Independent optical coefficients for each ordered atmospheric layer. */
    readonly layers: readonly ILayerOptics[];
    /** Molecular scattering coefficient, inverse metres. */
    readonly rayleigh: number;
    /** Aerosol scattering coefficient, inverse metres. */
    readonly scattering: number;
    /** Aerosol extinction coefficient, inverse metres. */
    readonly extinction: number;
    /** Stellar spectral irradiance, W per square metre per nanometre. */
    readonly solar: number;
    /** CIE XYZ quadrature weights, normalized to reference solar luminance. */
    readonly xyz: Vector3;
    /** Mie phase at a scattering-angle cosine, inverse steradians. */
    phase(mu: number): number;
}
/** Fully specified physical inputs, resolved from defaults and overrides. */
export type ResolvedPhysicalConfig = Required<Omit<IPhysicalAtmosphereConfig, "ellipsoid" | "layers">> &
    Pick<IPhysicalAtmosphereConfig, "ellipsoid" | "layers">;
/** Diagnostics and scientific limitations of the generated model. */
export interface IPhysicalSceneReport {
    /** Resolved editable physical parameters. */
    readonly config: ResolvedPhysicalConfig;
    /** Layer identities, analytic support and local physical state used by the renderer. */
    readonly layers: readonly IAtmosphereLayerDefinition[];
    /** Spectral interval endpoints, nanometres. */
    readonly wavelengthRangeNm: number[];
    /** Number of midpoint wavelengths. */
    readonly wavelengths: number;
    /** Midpoint quadrature step, nanometres. */
    readonly stepNm: number;
    /** Mean molecular mass, atomic mass units. */
    readonly meanMassAmu: number;
    /** Gas scale height, metres. */
    readonly gasScaleHeightMeters: number;
    /** Zero-altitude dust number density, particles per cubic metre. */
    readonly dustNumberDensityPerM3: number;
    /** Description of equations and approximations. */
    readonly method: string;
    /** Scientific limitations, independent of numerical checks. */
    readonly limitations: string;
}
/** Spectral single-scattering scene, independent from any renderer. */
export interface IPhysicalScene {
    /** Physical geometry and exponential density profiles. */
    readonly model: IAtmosphere;
    /** Spectral midpoint samples. */
    readonly bins: readonly ISpectralBin[];
    /** Resolved physical inputs. */
    readonly config: ResolvedPhysicalConfig;
    /** Number of three-wavelength groups for the optional laboratory GPU ABI. */
    readonly groups: number;
    /** Apparent stellar angular radius, radians. */
    readonly solarAngularRadius: number;
    /** Mean molecular mass, atomic mass units. */
    readonly meanMassAmu: number;
    /** Physical assumptions and quadrature metadata. */
    readonly report: IPhysicalSceneReport;
}
/** Direct CPU spectral integration quality. */
export interface ISpectralIntegrationOptions {
    /** Uniform view-ray quadrature steps. */
    steps?: number;
    /** Direct solar-ray density-column steps at each view position. */
    solarSteps?: number;
}
/** Direct ray result before display exposure and gamut clipping. */
export interface ISpectralRayResult {
    /** CIE-integrated linear sRGB, normalized to the reference solar luminance. */
    readonly radiance: Vector3;
    /** Transmitted incident spectrum integrated to linear RGB, not three independent physical transmittances. */
    readonly transmittance: Vector3;
    /** Per-wavelength path radiance per unit incident irradiance, inverse steradians. */
    readonly spectralRadiance: readonly number[];
}
/** Packed angular table used by the optional laboratory shader. */
export interface IPhaseTable {
    /** Angular sample count. */
    readonly width: number;
    /** Three-wavelength group count. */
    readonly height: number;
    /** Row-major RGBA32F phase values, inverse steradians. */
    readonly data: Float32Array;
}
import { WGS84, along, atmosphericInterval, dot, envelopeScale, intersectEllipsoid, normalize } from "./geometry";
import { LayeredAtmosphere, createAtmosphereLayer } from "./layers";
import type { IAtmosphere, IAtmosphereLayerDefinition, ILayerOptics } from "./layers";
import { dustOptics } from "./scattering";
/** Mars axes in metres, retained from the prototype physical preset. */
export const MARS = Object.freeze({ semiMajorAxis: 3396200, semiMinorAxis: 3376200 });
/** Editable initial physical states. Dust inputs are experimental assumptions, not calibrated Mars constants. */
export const physicalPresets: Readonly<Record<"earth" | "mars" | "co2", IPhysicalAtmosphereConfig>> = {
    earth: {
        planet: "earth",
        pressure: 101325,
        temperature: 288,
        gravity: 9.80665,
        mix: { N2: 78.08, O2: 20.95, CO2: 0.04, Ar: 0.93 },
        dustTau: 0.015,
        dustHeight: 1200,
        radiusUm: 0.1,
        logSigma: 0.3,
        indexN: 1.45,
        indexK: 0.003,
        distanceAU: 1,
    },
    mars: {
        planet: "mars",
        pressure: 636,
        temperature: 210,
        gravity: 3.71,
        mix: { N2: 2.6, O2: 0.16, CO2: 95, Ar: 1.9 },
        dustTau: 0.3,
        dustHeight: 10000,
        radiusUm: 0.7,
        logSigma: 0.3,
        indexN: 1.5,
        indexK: 0.003,
        distanceAU: 1.524,
    },
    co2: {
        planet: "mars",
        pressure: 636,
        temperature: 210,
        gravity: 3.71,
        mix: { N2: 0, O2: 0, CO2: 100, Ar: 0 },
        dustTau: 0,
        dustHeight: 10000,
        radiusUm: 0.7,
        logSigma: 0.3,
        indexN: 1.5,
        indexK: 0.003,
        distanceAU: 1.524,
    },
};
/** Solar-radius blackbody spectral irradiance at a distance in AU, W/m2/nm, for wavelength in nm. */
export function planckIrradiance(wavelengthNm: number, temperature = 5778, distanceAU = 1): number {
    const lambda = wavelengthNm * 1e-9;
    if (!(lambda > 0 && temperature >= 1000 && temperature <= 20000 && distanceAU > 0)) throw new Error("Invalid stellar spectrum");
    return (
        ((2 * 6.62607015e-34 * 299792458 ** 2) / lambda ** 5 / Math.expm1(0.01438776877 / (lambda * temperature))) *
        Math.PI *
        (695700000 / (distanceAU * 149597870700)) ** 2 *
        1e-9
    );
}
// Wyman, Sloan & Shirley 2013 analytic CIE 1931 observer, no planet-dependent color.
/** Analytic CIE 1931 observer response at a wavelength in nanometres. */
export function cieXYZ(w: number): number[] {
    const g = (mu: number, left: number, right: number) => Math.exp(-0.5 * ((w - mu) * (w < mu ? left : right)) ** 2);
    return [
        1.056 * g(599.8, 0.0264, 0.0323) + 0.362 * g(442, 0.0624, 0.0374) - 0.065 * g(501.1, 0.049, 0.0382),
        0.821 * g(568.8, 0.0213, 0.0247) + 0.286 * g(530.9, 0.0613, 0.0322),
        1.217 * g(437, 0.0845, 0.0278) + 0.681 * g(459, 0.0385, 0.0725),
    ];
}
/** Converts linear XYZ to linear sRGB without exposure, white balance or gamut clipping. */
export const xyzToLinearRgb = ([x, y, z]: Vector3) => [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
];
const solarY = Array.from({ length: 400 }, (_, i) => {
    const w = 380 + (i + 0.5);
    return planckIrradiance(w) * cieXYZ(w)[1];
}).reduce((a, b) => a + b, 0);
/** Creates a spectral scene on a geodesy-compatible ellipsoid, with a direction toward the star in ECEF. */
export function makePhysicalScene(config: IPhysicalAtmosphereConfig, sun: Vector3): IPhysicalScene {
    const defaults: ResolvedPhysicalConfig = {
        planet: "earth",
        pressure: 101325,
        temperature: 288,
        gravity: 9.80665,
        mix: { N2: 78.08, O2: 20.95, CO2: 0.04, Ar: 0.93 },
        dustTau: 0.015,
        dustHeight: 1200,
        radiusUm: 0.1,
        logSigma: 0.3,
        indexN: 1.45,
        indexK: 0.003,
        distanceAU: 1,
        source: "blackbody",
        starTemperature: 5778,
        bandCenter: 550,
        bandWidth: 80,
        wavelengths: 24,
    };
    const c: ResolvedPhysicalConfig = { ...defaults, ...config, mix: { ...(config.mix ?? defaults.mix) } };
    if (![24, 48].includes(c.wavelengths)) throw new Error("Choose 24 or 48 wavelengths");
    if (!(
        c.dustTau >= 0 &&
        c.dustTau <= 3 &&
        c.dustHeight > 0 &&
        c.distanceAU > 0 &&
        ["blackbody", "band"].includes(c.source ?? "blackbody")
    ))
        throw new Error("Invalid spectral state");
    if (c.source === "band" && !(c.bandCenter >= 380 && c.bandCenter <= 780 && c.bandWidth >= 20 && c.bandWidth <= 400))
        throw new Error("Invalid spectral band");
    const gas = mixtureOptics(c.mix, c.pressure, c.temperature, c.gravity, 550),
        reference = dustOptics(550, c);
    if (!(reference.extinction > 0) && c.dustTau > 0)
        throw new Error("Nonzero dust optical depth requires a nonzero extinction cross section");
    const numberDensity = c.dustTau === 0 ? 0 : c.dustTau / (c.dustHeight * reference.extinction);
    const top = Math.max(100000, gas.scaleHeight * 12),
        ellipsoid = c.ellipsoid ?? (c.planet === "mars" ? MARS : WGS84);
    const profile = (scale: number) => ({
        kind: "exponential" as const,
        bottomAltitudeMeters: 0,
        topAltitudeMeters: top,
        referenceAltitudeMeters: 0,
        scaleHeightMeters: scale,
        densityScale: 1,
    });
    const definitions: readonly IAtmosphereLayerDefinition[] = c.layers ?? [
        {
            id: "gas",
            kind: "gas",
            profile: profile(gas.scaleHeight),
            gas: {
                composition: compositionFromMixture(c.mix, c.pressure),
                pressurePa: c.pressure,
                temperatureK: c.temperature,
                gravity: c.gravity,
            },
        },
        {
            id: "dust",
            kind: "aerosol",
            profile: profile(c.dustHeight),
            aerosol: {
                radiusUm: c.radiusUm,
                logSigma: c.logSigma,
                indexN: c.indexN,
                indexK: c.indexK,
                numberDensityPerM3: numberDensity,
                particulate: { particulateId: "experimental-dust", displayName: "Experimental homogeneous-sphere dust", pmClass: "dust" },
            },
        },
    ];
    const actualTop = c.layers ? Math.max(...definitions.map((l) => l.profile.topAltitudeMeters), 1) : top;
    const model = new LayeredAtmosphere({ ellipsoid, top: actualTop, sun, layers: definitions.map(createAtmosphereLayer) });
    return spectralScene(model, c, c.layers ? 0 : gas.meanMassAmu, c.layers ? 0 : gas.scaleHeight, c.layers ? 0 : numberDensity);
}
/** Builds the optical scene directly from any structural IAtmosphere implementation, without a concrete class requirement. */
export function makeSpectralScene(
    atmosphere: IAtmosphere,
    illumination: Pick<
        IPhysicalAtmosphereConfig,
        "source" | "starTemperature" | "distanceAU" | "bandCenter" | "bandWidth" | "wavelengths"
    > = {},
): IPhysicalScene {
    const c: ResolvedPhysicalConfig = {
        planet: "earth",
        pressure: 0,
        temperature: 288,
        gravity: 9.80665,
        mix: { N2: 1 },
        dustTau: 0,
        dustHeight: 1200,
        radiusUm: 0.1,
        logSigma: 0.3,
        indexN: 1.45,
        indexK: 0.003,
        distanceAU: 1,
        source: "blackbody",
        starTemperature: 5778,
        bandCenter: 550,
        bandWidth: 80,
        wavelengths: 24,
        ...illumination,
    };
    if (![24, 48].includes(c.wavelengths)) throw new Error("Choose 24 or 48 wavelengths");
    if (c.source === "band" && !(c.bandCenter >= 380 && c.bandCenter <= 780 && c.bandWidth >= 20 && c.bandWidth <= 400))
        throw new Error("Invalid spectral band");
    return spectralScene(atmosphere, c, 0, 0, 0);
}
function spectralScene(
    model: IAtmosphere,
    c: ResolvedPhysicalConfig,
    mass: number,
    gasHeight: number,
    numberDensity: number,
): IPhysicalScene {
    const count = c.wavelengths,
        step = 400 / count;
    const bins: ISpectralBin[] = Array.from({ length: count }, (_, i) => {
        const w = 380 + (i + 0.5) * step,
            layers = model.layers.map((l) => l.optics(w));
        for (const layer of layers) {
            if (
                ![layer.rayleigh, layer.scattering, layer.extinction].every((v) => Number.isFinite(v) && v >= 0) ||
                layer.extinction + 1e-20 < layer.rayleigh + layer.scattering
            )
                throw new Error("Invalid or non-passive layer optics");
        }
        const input =
            c.source === "band"
                ? planckIrradiance(c.bandCenter, c.starTemperature, c.distanceAU) *
                  Math.exp(-4 * Math.log(2) * ((w - c.bandCenter) / c.bandWidth) ** 2)
                : planckIrradiance(w, c.starTemperature, c.distanceAU);
        const scattering = layers.reduce((sum, v) => sum + v.scattering, 0);
        return {
            wavelengthNm: w,
            layers,
            rayleigh: layers.reduce((sum, v) => sum + v.rayleigh, 0),
            scattering,
            extinction: layers.reduce((sum, v) => sum + v.extinction - v.rayleigh, 0),
            solar: input,
            xyz: cieXYZ(w).map((v) => (v * step) / solarY),
            phase: (mu: number) => (scattering > 0 ? layers.reduce((sum, v) => sum + v.scattering * v.phase(mu), 0) / scattering : 0),
        };
    });
    const definitions = model.layers.map((l) => ({
        id: l.id,
        kind: l.kind,
        profile: l.profile,
        ...(l.gas ? { gas: l.gas } : {}),
        ...(l.aerosol ? { aerosol: l.aerosol } : {}),
    }));
    return {
        model,
        bins,
        config: c,
        groups: count / 3,
        solarAngularRadius: 0.00465047 / c.distanceAU,
        meanMassAmu: mass,
        report: {
            config: c,
            layers: definitions,
            wavelengthRangeNm: [380, 780],
            wavelengths: count,
            stepNm: step,
            meanMassAmu: mass,
            gasScaleHeightMeters: gasHeight,
            dustNumberDensityPerM3: numberDensity,
            method: "Layered IAtmosphere spectral single scattering, ideal gas, static polarizabilities, homogeneous-sphere Mie and lognormal particles, Planck or Gaussian source, CIE XYZ to linear sRGB. Reference-state summaries are zero when no global reference state is supplied.",
            limitations:
                "No molecular absorption lines, multiple scattering, polarization or nonspherical dust. Layer-local n,k are constant across wavelengths. No PDS calibration has been performed.",
        },
    };
}
/** Packs three wavelengths per 304-byte record with four layer slots; scattering coefficients use inverse kilometres for the laboratory shader. */
export function spectrumBuffer(scene: IPhysicalScene): Float32Array {
    const data: number[] = [];
    for (let i = 0; i < scene.bins.length; i += 3) {
        const b = scene.bins.slice(i, i + 3),
            push = (values: readonly number[]) => data.push(...values, 0);
        for (const key of ["rayleigh", "scattering", "extinction"] as const) push(b.map((v) => v[key] * 1000));
        for (let c = 0; c < 3; c++) push(b.map((v) => v.xyz[c]));
        push(b.map((v) => v.solar));
        if (scene.model.layers.length > 4) throw new Error("Laboratory GPU ABI supports at most four layers");
        for (let l = 0; l < 4; l++)
            for (const key of ["rayleigh", "scattering", "extinction"] as const) push(b.map((v) => (v.layers[l]?.[key] ?? 0) * 1000));
    }
    return new Float32Array(data);
}
/** Samples the calculated Mie angular phase, concentrated near forward scattering. */
export function phaseTable(scene: IPhysicalScene, count = 512): IPhaseTable {
    if (!Number.isInteger(count) || count < 2) throw new Error("Invalid phase table width");
    const height = scene.groups * scene.model.layers.length,
        data = new Float32Array(count * height * 4);
    for (let l = 0; l < scene.model.layers.length; l++)
        for (let i = 0; i < scene.groups; i++)
            for (let x = 0; x < count; x++)
                for (let c = 0; c < 3; c++)
                    data[((l * scene.groups + i) * count + x) * 4 + c] = scene.bins[3 * i + c].layers[l].phase(
                        Math.cos(Math.PI * (x / (count - 1)) ** 2),
                    );
    return { width: count, height, data };
}
/** Independent CPU spectral ray marcher, uses direct solar density columns, not the GPU LUT. */
export function integrateSpectral(
    scene: IPhysicalScene,
    origin: Vector3,
    direction: Vector3,
    { steps = 256, solarSteps = 96 }: ISpectralIntegrationOptions = {},
): ISpectralRayResult {
    if (![steps, solarSteps].every((n) => Number.isInteger(n) && n > 0)) throw new Error("Positive integer spectral step counts required");
    direction = normalize(direction);
    const m = scene.model,
        interval = atmosphericInterval(m, origin, direction),
        n = scene.bins.length,
        L = Array(n).fill(0),
        T = Array(n).fill(1);
    const mu = dot(direction, m.sun),
        phaseR = (3 * (1 + mu * mu)) / (16 * Math.PI),
        phase = scene.bins.map((b) => b.layers.map((l) => l.phase(mu)));
    if (interval) {
        const ds = (interval.end - interval.start) / steps;
        for (let i = 0; i < steps; i++) {
            const p = along(origin, direction, interval.start + (i + 0.5) * ds),
                rho = m.density(p);
            if (!rho.some((x) => x > 0)) continue;
            const ground = intersectEllipsoid(m.ellipsoid, p, m.sun),
                blocked = ground && ground[1] > 1e-4 && ground[0] >= -1e-4;
            const col = Array(m.layers.length).fill(0) as number[];
            if (!blocked) {
                const end = intersectEllipsoid(m.ellipsoid, p, m.sun, envelopeScale(m.ellipsoid, m.top))?.[1] ?? 0,
                    delta = end / solarSteps;
                for (let j = 0; j < solarSteps; j++) {
                    const d = m.density(along(p, m.sun, (j + 0.5) * delta));
                    for (let l = 0; l < col.length; l++) col[l] += d[l] * delta;
                }
            }
            for (let j = 0; j < n; j++) {
                const b = scene.bins[j];
                let ext = 0,
                    tau = 0,
                    source = 0;
                for (let l = 0; l < m.layers.length; l++) {
                    const o = b.layers[l];
                    ext += o.extinction * rho[l];
                    tau += o.extinction * col[l];
                    source += rho[l] * (o.rayleigh * phaseR + o.scattering * phase[j][l]);
                }
                const stepT = Math.exp(-ext * ds),
                    solar = blocked ? 0 : Math.exp(-tau);
                L[j] += T[j] * solar * source * (ext > 0 ? -Math.expm1(-ext * ds) / ext : ds);
                T[j] *= stepT;
            }
        }
    }
    const xyz = [0, 0, 0],
        transmission = [0, 0, 0];
    scene.bins.forEach((b, j) =>
        b.xyz.forEach((w, c) => {
            xyz[c] += L[j] * b.solar * w;
            transmission[c] += T[j] * b.solar * w;
        }),
    );
    return { radiance: xyzToLinearRgb(xyz), transmittance: xyzToLinearRgb(transmission), spectralRadiance: L };
}
