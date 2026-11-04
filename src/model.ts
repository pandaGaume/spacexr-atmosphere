import type { IEllipsoidAxes, Vector3 } from "./types";
/** Immutable atmosphere inputs. Coefficients are inverse metres at zero geodetic height. */
export interface IAtmosphereOptions {
    /** Planet axes, metres; defaults to WGS84 from geodesy. */
    ellipsoid?: IEllipsoidAxes;
    /** Atmosphere top, metres. */
    top?: number;
    /** Rayleigh density scale height, metres. */
    rayleighHeight?: number;
    /** Aerosol density scale height, metres. */
    mieHeight?: number;
    /** RGB Rayleigh scattering coefficients, inverse metres. */
    rayleigh?: Vector3;
    /** Grey aerosol scattering coefficient, inverse metres. */
    mieScattering?: number;
    /** Grey aerosol extinction coefficient, inverse metres. */
    mieExtinction?: number;
    /** Direction toward the star in ECEF. */
    sun?: Vector3;
    /** Number of direct solar integration steps. */
    solarSteps?: number;
}
/** Mutable diagnostics, excluded from physical cache signatures. */
export interface IAtmosphereStats {
    /** Density evaluations since reset. */
    densityEvaluations: number;
    /** Direct solar integrations since reset. */
    solarIntegrations: number;
}
import { WGS84, altitude, along, envelopeScale, inside, intersectEllipsoid, normalize, validateEllipsoid } from "./geometry";
/** Immutable exponential atmosphere on an oblate ellipsoid, with ECEF metres and polar axis Z. */
export class Atmosphere {
    /** Copied immutable planet dimensions, metres. */
    public readonly ellipsoid: Readonly<IEllipsoidAxes>;
    /** Geodetic top altitude, metres. */
    public readonly top: number;
    /** Molecular scale height, metres. */
    public readonly rayleighHeight: number;
    /** Aerosol scale height, metres. */
    public readonly mieHeight: number;
    /** RGB molecular scattering coefficients, inverse metres. */
    public readonly rayleigh: Vector3;
    /** Grey aerosol scattering coefficient, inverse metres. */
    public readonly mieScattering: number;
    /** Grey aerosol extinction coefficient, inverse metres. */
    public readonly mieExtinction: number;
    /** Unit direction toward the star in ECEF. */
    public readonly sun: Vector3;
    /** Direct solar quadrature steps. */
    public readonly solarSteps: number;
    /** Mutable instrumentation counters, separate from physical state. */
    public readonly stats: IAtmosphereStats;
    /** Creates a validated immutable physical model. */
    constructor({
        ellipsoid = WGS84,
        top = 100000,
        rayleighHeight = 8000,
        mieHeight = 1200,
        rayleigh = [5.802e-6, 13.558e-6, 33.1e-6],
        mieScattering = 3.996e-6,
        mieExtinction = 4.44e-6,
        sun = [1, 0, 0],
        solarSteps = 64,
    }: IAtmosphereOptions = {}) {
        validateEllipsoid(ellipsoid);
        if (![top, rayleighHeight, mieHeight].every((x) => Number.isFinite(x) && x > 0) || !Number.isInteger(solarSteps) || solarSteps < 1)
            throw new Error("Invalid atmosphere sampling parameters");
        if (
            rayleigh.length !== 3 ||
            !rayleigh.every((x) => Number.isFinite(x) && x >= 0) ||
            !(mieScattering >= 0 && mieExtinction >= mieScattering && Number.isFinite(mieExtinction))
        )
            throw new Error("Invalid optical coefficients");
        this.ellipsoid = Object.freeze({ semiMajorAxis: ellipsoid.semiMajorAxis, semiMinorAxis: ellipsoid.semiMinorAxis });
        this.top = top;
        this.rayleighHeight = rayleighHeight;
        this.mieHeight = mieHeight;
        this.rayleigh = Object.freeze([...rayleigh]);
        this.mieScattering = mieScattering;
        this.mieExtinction = mieExtinction;
        this.sun = Object.freeze(normalize(sun));
        this.solarSteps = solarSteps;
        this.stats = { densityEvaluations: 0, solarIntegrations: 0 };
        Object.freeze(this);
    }
    /** Resets instrumentation without changing physical state. */
    public resetStats(): void {
        this.stats.densityEvaluations = 0;
        this.stats.solarIntegrations = 0;
    }
    /** Exponential molecular and aerosol densities at an ECEF position in metres. */
    public density(p: Vector3): [number, number] {
        this.stats.densityEvaluations++;
        const h = altitude(this.ellipsoid, p);
        return h < 0 || h > this.top ? [0, 0] : [Math.exp(-h / this.rayleighHeight), Math.exp(-h / this.mieHeight)];
    }
    /** RGB extinction in inverse metres for a pair of density multipliers. */
    public extinction(density: readonly number[]) {
        return this.rayleigh.map((r) => r * density[0] + this.mieExtinction * density[1]);
    }
    /** Direct RGB solar transmission at an ECEF position, including planetary occultation. */
    public solarTransmittance(p: Vector3, steps = this.solarSteps) {
        if (!Number.isInteger(steps) || steps < 1) throw new Error("Invalid solar step count");
        this.stats.solarIntegrations++;
        if (inside(this.ellipsoid, p)) return [0, 0, 0];
        const ground = intersectEllipsoid(this.ellipsoid, p, this.sun);
        if (ground && ground[1] > 1e-4 && ground[0] >= -1e-4) return [0, 0, 0];
        const bound = intersectEllipsoid(this.ellipsoid, p, this.sun, envelopeScale(this.ellipsoid, this.top));
        if (!bound || bound[1] <= 0) return [1, 1, 1];
        const length = bound[1],
            ds = length / steps,
            optical = [0, 0, 0];
        for (let i = 0; i < steps; i++) {
            const extinction = this.extinction(this.density(along(p, this.sun, (i + 0.5) * ds)));
            for (let c = 0; c < 3; c++) optical[c] += extinction[c] * ds;
        }
        return optical.map((t) => Math.exp(-t));
    }
}
