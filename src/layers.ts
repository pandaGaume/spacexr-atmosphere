import { altitude, along, envelopeScale, inside, intersectEllipsoid, normalize, validateEllipsoid } from "./geometry";
import { compositionOptics, copyComposition } from "./composition";
import type { ICompositionView, IParticulateMetadata, MolecularOpticalRegistry } from "./composition";
import { dustOptics } from "./scattering";

import type { IDustOptions } from "./scattering";
import type { IAtmosphericBounds, IEllipsoidAxes, Vector3 } from "./types";
/** Altitude-dependent density multiplier, independent of optical coefficients. */
export interface ILayerProfile {
    /** Geodetic lower boundary, inclusive, metres. */
    readonly bottomAltitudeMeters: number;
    /** Geodetic upper boundary, exclusive, metres. */
    readonly topAltitudeMeters: number;
    /** Analytic density model supported by CPU and laboratory GPU. */
    readonly kind: "exponential" | "constant" | "gaussian";
    /** Height where the multiplier equals densityScale, metres. */
    readonly referenceAltitudeMeters: number;
    /** Exponential scale height or Gaussian standard deviation, metres. */
    readonly scaleHeightMeters: number;
    /** Nonnegative density multiplier at the reference height. */
    readonly densityScale: number;
}
/** Spectral coefficients belonging to one layer, before applying its altitude profile. */
export interface ILayerOptics {
    /** Rayleigh scattering, inverse metres. */
    readonly rayleigh: number;
    /** Aerosol scattering, inverse metres. */
    readonly scattering: number;
    /** Total scattering plus absorption, inverse metres. */
    readonly extinction: number;
    /** Normalized aerosol phase, inverse steradians, for a scattering-angle cosine. */
    phase(mu: number): number;
}
/** Autonomous layer contract. A layer owns its physical state and its vertical profile. */
export interface IAtmosphereLayer {
    /** Unique stable identifier within its atmosphere. */
    readonly id: string;
    /** Descriptive layer category, not an imposed display color. */
    readonly kind: "gas" | "aerosol";
    /** Analytic density support and shape. */
    readonly profile: ILayerProfile;
    /** Optional layer-local gas composition and thermodynamic state. */
    readonly gas?: Readonly<IGasLayerState>;
    /** Optional layer-local particulate state. */
    readonly aerosol?: Readonly<IAerosolLayerState>;
    /** Returns optical coefficients at a wavelength in nanometres. */
    optics(wavelengthNm: number): ILayerOptics;
}
/** Thermodynamic and compositional state at a gas layer's reference altitude. */
export interface IGasLayerState {
    /** Relative molar fractions, jointly normalized. */
    readonly composition: ICompositionView;
    /** Optional additional species optical properties, independent from chemical metadata. */
    readonly opticalSpecies?: MolecularOpticalRegistry;
    /** Reference pressure, pascals. */
    readonly pressurePa: number;
    /** Layer temperature, kelvins. */
    readonly temperatureK: number;
    /** Gravity for deriving the isothermal scale height, metres per squared second. */
    readonly gravity: number;
}
/** Layer-local particle distribution and number density. */
export interface IAerosolLayerState extends IDustOptions {
    /** Reference number density of particles, per cubic metre. */
    readonly numberDensityPerM3: number;
    /** Structural particulate metadata from a composition or physics catalog. */
    readonly particulate?: IParticulateMetadata;
}
/** Serializable layer definition consumed by the laboratory editor and factories. */
export interface IAtmosphereLayerDefinition {
    /** Layer identifier. */
    readonly id: string;
    /** Gas or particulate medium. */
    readonly kind: "gas" | "aerosol";
    /** Vertical support and profile in geodetic metres. */
    readonly profile: ILayerProfile;
    /** Required for a gas layer. */
    readonly gas?: IGasLayerState;
    /** Required for an aerosol layer. */
    readonly aerosol?: IAerosolLayerState;
}
/** Renderer-facing atmosphere contract, composed of independent layers. */
export interface IAtmosphere extends IAtmosphericBounds {
    /** Ordered active layer set. Overlapping layers add local optical coefficients. */
    readonly layers: readonly IAtmosphereLayer[];
    /** Unit ECEF direction toward the star. */
    readonly sun: Vector3;
    /** Default direct solar quadrature count. */
    readonly solarSteps: number;
    /** Samples one density multiplier per layer at ECEF metres; optional target is reused. */
    density(position: Vector3, target?: number[]): number[];
    /** Direct solar transmission at representative RGB wavelengths, including planetary shadow. */
    solarTransmittance(position: Vector3, steps?: number): Vector3;
}
/** Immutable layered-atmosphere construction inputs. */
export interface ILayeredAtmosphereOptions {
    /** Planet dimensions, metres. */
    readonly ellipsoid: IEllipsoidAxes;
    /** Geodetic atmosphere top, metres. */
    readonly top: number;
    /** Autonomous layer implementations, accepted structurally. */
    readonly layers: readonly IAtmosphereLayer[];
    /** ECEF direction toward the star. */
    readonly sun: Vector3;
    /** Optional direct solar quadrature steps. */
    readonly solarSteps?: number;
}
/** Validates and copies the analytic profile so callers cannot invalidate caches by mutation. */
export function copyLayerProfile(profile: ILayerProfile): Readonly<ILayerProfile> {
    if (
        ![
            profile.bottomAltitudeMeters,
            profile.topAltitudeMeters,
            profile.referenceAltitudeMeters,
            profile.scaleHeightMeters,
            profile.densityScale,
        ].every(Number.isFinite) ||
        profile.bottomAltitudeMeters < 0 ||
        profile.topAltitudeMeters <= profile.bottomAltitudeMeters ||
        profile.scaleHeightMeters <= 0 ||
        profile.densityScale < 0 ||
        !["exponential", "constant", "gaussian"].includes(profile.kind)
    )
        throw new Error("Invalid atmospheric layer profile");
    return Object.freeze({ ...profile });
}
/** Evaluates a density multiplier inside its altitude support, with no radial approximation. */
export function layerDensityAtAltitude(profile: ILayerProfile, heightMeters: number): number {
    if (heightMeters < profile.bottomAltitudeMeters || heightMeters >= profile.topAltitudeMeters) return 0;
    const x = (heightMeters - profile.referenceAltitudeMeters) / profile.scaleHeightMeters;
    return profile.densityScale * (profile.kind === "constant" ? 1 : Math.exp(profile.kind === "gaussian" ? -0.5 * x * x : -x));
}
/** Creates an immutable gas or aerosol layer from a serializable physical definition. */
export function createAtmosphereLayer(definition: IAtmosphereLayerDefinition): IAtmosphereLayer {
    if (!definition.id.trim()) throw new Error("Layer id must not be empty");
    const profile = copyLayerProfile(definition.profile),
        cache = new Map<number, ILayerOptics>();
    if (definition.kind === "gas") {
        if (!definition.gas) throw new Error("Gas layer requires its own composition, pressure and temperature");
        const gas = Object.freeze({
            ...definition.gas,
            composition: copyComposition({ ...definition.gas.composition, referencePressurePa: definition.gas.pressurePa }),
        });
        compositionOptics(gas.composition, gas.temperatureK, gas.gravity, 550, gas.opticalSpecies);
        return Object.freeze({
            id: definition.id,
            kind: "gas" as const,
            profile,
            gas,
            optics(wavelengthNm: number): ILayerOptics {
                let value = cache.get(wavelengthNm);
                if (!value) {
                    const r = compositionOptics(gas.composition, gas.temperatureK, gas.gravity, wavelengthNm, gas.opticalSpecies).beta;
                    value = Object.freeze({ rayleigh: r, scattering: 0, extinction: r, phase: () => 0 });
                    cache.set(wavelengthNm, value);
                }
                return value;
            },
        });
    }
    if (
        definition.kind !== "aerosol" ||
        !definition.aerosol ||
        !Number.isFinite(definition.aerosol.numberDensityPerM3) ||
        definition.aerosol.numberDensityPerM3 < 0
    )
        throw new Error("Aerosol layer requires nonnegative particle density");
    if (
        definition.aerosol.particulate &&
        (definition.aerosol.radiusUm === undefined || definition.aerosol.indexN === undefined || definition.aerosol.indexK === undefined)
    )
        throw new Error("Particulate metadata needs explicit optical radius and complex refractive index");
    const aerosol = Object.freeze({
        ...definition.aerosol,
        ...(definition.aerosol.particulate ? { particulate: Object.freeze({ ...definition.aerosol.particulate }) } : {}),
    });
    dustOptics(550, aerosol);
    return Object.freeze({
        id: definition.id,
        kind: "aerosol" as const,
        profile,
        aerosol,
        optics(wavelengthNm: number): ILayerOptics {
            let value = cache.get(wavelengthNm);
            if (!value) {
                const d = dustOptics(wavelengthNm, aerosol);
                value = Object.freeze({
                    rayleigh: 0,
                    scattering: d.scattering * aerosol.numberDensityPerM3,
                    extinction: d.extinction * aerosol.numberDensityPerM3,
                    phase: (mu: number) => d.phase(mu),
                });
                cache.set(wavelengthNm, value);
            }
            return value;
        },
    });
}
/** Reference container implementation. Consumers depend on IAtmosphere, not on this class. */
export class LayeredAtmosphere implements IAtmosphere {
    /** Immutable copied planet dimensions, metres. */
    public readonly ellipsoid: IEllipsoidAxes;
    /** Geodetic atmosphere top, metres. */
    public readonly top: number;
    /** Ordered autonomous layer implementations. */
    public readonly layers: readonly IAtmosphereLayer[];
    /** Unit ECEF direction toward the star. */
    public readonly sun: Vector3;
    /** Default direct solar quadrature count. */
    public readonly solarSteps: number;
    /** Constructs a layer container with no simulation-session or renderer dependency. */
    public constructor(options: ILayeredAtmosphereOptions) {
        if (!(options.top > 0 && Number.isFinite(options.top))) throw new Error("Invalid atmosphere top");
        // Validation and conversion authority remains the geodesy-backed geometry module.
        validateEllipsoid(options.ellipsoid);
        this.ellipsoid = Object.freeze({
            semiMajorAxis: options.ellipsoid.semiMajorAxis,
            semiMinorAxis: options.ellipsoid.semiMinorAxis,
        });
        this.top = options.top;
        this.layers = Object.freeze([...options.layers]);
        this.sun = Object.freeze(normalize(options.sun));
        this.solarSteps = options.solarSteps ?? 64;
        if (!Number.isInteger(this.solarSteps) || this.solarSteps < 1) throw new Error("Invalid solar integration step count");
        const ids = new Set<string>();
        for (const l of this.layers) {
            copyLayerProfile(l.profile);
            if (ids.has(l.id)) throw new Error("Duplicate atmospheric layer id");
            ids.add(l.id);
            if (l.profile.topAltitudeMeters > this.top) throw new Error("Layer exceeds atmosphere top");
        }
        const particulateIds = new Set(this.layers.flatMap((l) => (l.aerosol?.particulate ? [l.aerosol.particulate.particulateId] : [])));
        for (const layer of this.layers)
            for (const particulate of layer.gas?.composition.particulates ?? [])
                if (!particulateIds.has(particulate.particulateId))
                    throw new Error(`Missing optical aerosol layer for particulate ${particulate.particulateId}`);
        Object.freeze(this);
    }
    /** One density multiplier per layer at an ECEF position in metres. */
    public density(position: Vector3, target: number[] = []): number[] {
        const h = altitude(this.ellipsoid, position);
        target.length = this.layers.length;
        for (let i = 0; i < this.layers.length; i++)
            target[i] = h < 0 || h > this.top ? 0 : layerDensityAtAltitude(this.layers[i].profile, h);
        return target;
    }
    /** Direct stellar transmission sampled at 680, 550 and 440 nm; does not impose sky colors. */
    public solarTransmittance(position: Vector3, steps = this.solarSteps): Vector3 {
        if (!Number.isInteger(steps) || steps < 1) throw new Error("Invalid solar integration step count");
        if (inside(this.ellipsoid, position)) return [0, 0, 0];
        const hit = intersectEllipsoid(this.ellipsoid, position, this.sun);
        if (hit && hit[1] > 1e-4 && hit[0] >= -1e-4) return [0, 0, 0];
        const bound = intersectEllipsoid(this.ellipsoid, position, this.sun, envelopeScale(this.ellipsoid, this.top));
        if (!bound || bound[1] <= 0) return [1, 1, 1];
        const ds = bound[1] / steps,
            tau = [0, 0, 0],
            coeff = [680, 550, 440].map((w) => this.layers.map((l) => l.optics(w).extinction)),
            rho: number[] = [];
        for (let i = 0; i < steps; i++) {
            this.density(along(position, this.sun, (i + 0.5) * ds), rho);
            for (let c = 0; c < 3; c++) for (let l = 0; l < this.layers.length; l++) tau[c] += rho[l] * coeff[c][l] * ds;
        }
        return tau.map((v) => Math.exp(-v));
    }
}
/** Packs up to four analytic profiles for the optional laboratory WGSL adapter. CPU integration has no such limit. */
export function packLayerProfiles(atmosphere: IAtmosphere): Float32Array {
    if (atmosphere.layers.length < 1 || atmosphere.layers.length > 4)
        throw new Error("Laboratory WebGPU adapter supports one to four atmospheric layers");
    return new Float32Array(
        atmosphere.layers.flatMap((l) => {
            const p = l.profile;
            return [
                p.bottomAltitudeMeters / 1000,
                p.topAltitudeMeters / 1000,
                p.referenceAltitudeMeters / 1000,
                p.scaleHeightMeters / 1000,
                p.densityScale,
                p.kind === "constant" ? 1 : p.kind === "gaussian" ? 2 : 0,
                0,
                0,
            ];
        }),
    );
}
