import { describe, expect, it } from "vitest";
import { Ellipsoid, GeodeticSystem } from "@spacexr/geodesy";
import {
    Atmosphere,
    LayeredAtmosphere,
    altitude,
    compositionFromMixture,
    compositionOptics,
    createAtmosphereLayer,
    geodeticPosition,
    geodeticToEcef,
    integrateSpectral,
    layerDensityAtAltitude,
    makePhysicalScene,
    makeSpectralScene,
    packLayerProfiles,
    physicalPresets,
} from "../src";
import type { IAtmosphere, IAtmosphereLayer, ICompositionView, ILayerProfile } from "../src";
const profile: ILayerProfile = {
    kind: "constant",
    bottomAltitudeMeters: 0,
    topAltitudeMeters: 1000,
    referenceAltitudeMeters: 0,
    scaleHeightMeters: 1,
    densityScale: 1,
};
const molecular = (id: string, extinction = 1e-5): IAtmosphereLayer => ({
    id,
    kind: "gas",
    profile,
    optics: () => ({ rayleigh: 0, scattering: 0, extinction, phase: () => 0 }),
});
describe("geodesy dependency boundary", () => {
    it("uses actual npm ellipsoids and reuses supplied Cartesian targets", () => {
        const mars = Ellipsoid.fromAxes("Mars", 3396200, 3376200),
            target = { x: 0, y: 0, z: 0 };
        expect(geodeticToEcef(mars, 0.5, 0.4, 1200, target)).toBe(target);
        const expected = new GeodeticSystem(mars).geodeticRadiansToEcef(0.5, 0.4, 1200);
        expect(target).toEqual(expected);
        expect(altitude(mars, [target.x, target.y, target.z])).toBeCloseTo(1200, 6);
    });
    it("keeps the old physical model immutable with structural geodesy axes", () => {
        const m = new Atmosphere({ ellipsoid: Ellipsoid.WGS84 });
        expect(Object.isFrozen(m)).toBe(true);
        expect(m.ellipsoid.semiMajorAxis).toBe(Ellipsoid.WGS84.semiMajorAxis);
    });
});
describe("IAtmosphere and independent layers", () => {
    it("integrates structurally supplied layers without requiring their concrete classes", () => {
        const model = new LayeredAtmosphere({
            ellipsoid: Ellipsoid.sphere("Test", 100000),
            top: 1000,
            sun: [1, 0, 0],
            layers: [molecular("a"), molecular("b", 2e-5)],
        });
        const duck: IAtmosphere = {
            ellipsoid: model.ellipsoid,
            top: model.top,
            layers: model.layers,
            sun: model.sun,
            solarSteps: model.solarSteps,
            density: (p, t) => model.density(p, t),
            solarTransmittance: (p, n) => model.solarTransmittance(p, n),
        };
        const scene = makeSpectralScene(duck),
            origin = geodeticPosition(model.ellipsoid, 0, 0, 100);
        expect(scene.model).toBe(duck);
        expect(scene.bins[0].layers).toHaveLength(2);
        expect(model.solarTransmittance(origin)[0]).toBeCloseTo(Math.exp(-3e-5 * 900), 11);
        expect(integrateSpectral(scene, origin, [1, 0, 0]).spectralRadiance.every((v) => v === 0)).toBe(true);
    });
    it("uses geodetic bounds and independent analytic profiles", () => {
        const exponential = { ...profile, kind: "exponential" as const, referenceAltitudeMeters: 100, scaleHeightMeters: 200 };
        const gaussian = { ...profile, kind: "gaussian" as const, referenceAltitudeMeters: 500, scaleHeightMeters: 100 };
        expect(layerDensityAtAltitude(profile, 1000)).toBe(0);
        expect(layerDensityAtAltitude(profile, -1)).toBe(0);
        expect(layerDensityAtAltitude(exponential, 300)).toBeCloseTo(Math.exp(-1), 12);
        expect(layerDensityAtAltitude(gaussian, 500)).toBe(1);
        expect(layerDensityAtAltitude(gaussian, 600)).toBeCloseTo(Math.exp(-0.5), 12);
    });
    it("rejects duplicate layers and explicitly enforces only the GPU packing limit", () => {
        const options = { ellipsoid: Ellipsoid.WGS84, top: 1000, sun: [1, 0, 0], layers: [molecular("a"), molecular("a")] };
        expect(() => new LayeredAtmosphere(options)).toThrow(/Duplicate/);
        const many = new LayeredAtmosphere({ ...options, layers: Array.from({ length: 5 }, (_, i) => molecular(String(i))) });
        expect(makeSpectralScene(many).bins[0].layers).toHaveLength(5);
        expect(() => packLayerProfiles(many)).toThrow(/four/);
    });
    it("reuses density output targets and derives independent gas and aerosol layers", () => {
        const scene = makePhysicalScene(physicalPresets.mars, [1, 0, 0]),
            p = geodeticPosition(scene.model.ellipsoid, 0, 0, 1000),
            target: number[] = [];
        expect(scene.model.layers.map((l) => l.kind)).toEqual(["gas", "aerosol"]);
        expect(scene.model.density(p, target)).toBe(target);
        expect(target).toHaveLength(2);
    });
});
describe("spikypanda composition and particle contracts", () => {
    const composition: ICompositionView = {
        referencePressurePa: 600,
        components: [
            { speciesId: "CO2", moleFraction: 0.95, molarMass: 0.0440095 },
            { speciesId: "H2O", moleFraction: 0.05, molarMass: 0.01801528 },
        ],
        particulates: [],
    };
    it("accepts component snapshots with SI molar masses, including water vapor", () => {
        const optics = compositionOptics(composition, 210, 3.71, 550);
        expect(optics.beta).toBeGreaterThan(0);
        expect(optics.meanMassAmu).toBeCloseTo((0.95 * 0.0440095 + 0.05 * 0.01801528) * 1000, 10);
        const layer = createAtmosphereLayer({
            id: "humid",
            kind: "gas",
            profile,
            gas: { composition, pressurePa: 600, temperatureK: 210, gravity: 3.71 },
        });
        expect(layer.gas?.composition.components[1]?.speciesId).toBe("H2O");
        expect(layer.optics(550).rayleigh).toBeCloseTo(optics.beta, 15);
    });
    it("requires explicit optical data for unknown species instead of guessing a color", () => {
        const custom = { ...composition, components: [{ speciesId: "custom-gas", moleFraction: 1, molarMass: 0.04 }] };
        expect(() => compositionOptics(custom, 210, 3.71, 550)).toThrow(/Missing molecular/);
        expect(compositionOptics(custom, 210, 3.71, 550, { "custom-gas": { polarizabilityAngstrom3: 2 } }).beta).toBeGreaterThan(0);
    });
    it("does not convert aerodynamic particulate diameter into a Mie radius", () => {
        const particulate = { particulateId: "pm", displayName: "PM2.5", characteristicDiameter: 2.5e-6, density: 2500, pmClass: "pm2_5" };
        expect(() =>
            createAtmosphereLayer({ id: "dust", kind: "aerosol", profile, aerosol: { numberDensityPerM3: 100, particulate } }),
        ).toThrow(/explicit optical radius/);
        const a = createAtmosphereLayer({
            id: "dust",
            kind: "aerosol",
            profile,
            aerosol: { numberDensityPerM3: 100, particulate, radiusUm: 0.4, indexN: 1.5, indexK: 0.003 },
        });
        const b = createAtmosphereLayer({
            id: "other",
            kind: "aerosol",
            profile,
            aerosol: {
                numberDensityPerM3: 100,
                particulate: { ...particulate, pmClass: "smoke", characteristicDiameter: 1e-4 },
                radiusUm: 0.4,
                indexN: 1.5,
                indexK: 0.003,
            },
        });
        expect(a.optics(550).extinction).toBe(b.optics(550).extinction);
        expect(a.aerosol?.particulate).toEqual(particulate);
    });
    it("never silently drops particulates bound through a composition", () => {
        const p = { particulateId: "dust", displayName: "Bound dust" };
        const gas = createAtmosphereLayer({
            id: "gas",
            kind: "gas",
            profile,
            gas: { composition: { ...composition, particulates: [p] }, pressurePa: 600, temperatureK: 210, gravity: 3.71 },
        });
        expect(() => new LayeredAtmosphere({ ellipsoid: Ellipsoid.WGS84, top: 1000, sun: [1, 0, 0], layers: [gas] })).toThrow(
            /Missing optical aerosol/,
        );
        const dust = createAtmosphereLayer({
            id: "dust",
            kind: "aerosol",
            profile,
            aerosol: { numberDensityPerM3: 100, particulate: p, radiusUm: 0.4, indexN: 1.5, indexK: 0.003 },
        });
        expect(new LayeredAtmosphere({ ellipsoid: Ellipsoid.WGS84, top: 1000, sun: [1, 0, 0], layers: [gas, dust] }).layers).toHaveLength(
            2,
        );
    });
    it("normalizes shorthand mixtures while preserving their chemical identity", () => {
        expect(compositionFromMixture({ N2: 78, O2: 21, H2O: 1 }, 101325).components.map((v) => v.speciesId)).toEqual(["N2", "O2", "H2O"]);
    });
});

describe("preserved spikypanda data catalogs", () => {
    it("retains catalog species identities, SI molar masses and particulate descriptors", async () => {
        const { COMPOSITION_PRESETS, MARS_ATMOSPHERE_PRESET, PARTICULATE_PRESETS } = await import("../src");
        expect(COMPOSITION_PRESETS.map((p) => p.presetId)).toEqual([
            "earthHumidAirSeaLevel",
            "earthDryAirSeaLevel",
            "marsAtmosphereMean",
            "issCabinECLSS",
            "vacuum",
        ]);
        expect(MARS_ATMOSPHERE_PRESET.referencePressurePa).toBe(600);
        expect(MARS_ATMOSPHERE_PRESET.components.find((c) => c.speciesId === "H2O")?.molarMass).toBe(0.01801528);
        expect(PARTICULATE_PRESETS.find((p) => p.particulateId === "pm2_5")?.characteristicDiameter).toBe(2.5e-6);
        expect(PARTICULATE_PRESETS.find((p) => p.particulateId === "lunar_dust")?.density).toBe(3100);
    });
});

it("rejects non-passive optics from structural atmosphere implementations", () => {
    const invalid: IAtmosphereLayer = {
        id: "invalid",
        kind: "gas",
        profile,
        optics: () => ({ rayleigh: 1, scattering: 0, extinction: 0.5, phase: () => 0 }),
    };
    const model = new LayeredAtmosphere({ ellipsoid: Ellipsoid.WGS84, top: 1000, sun: [1, 0, 0], layers: [invalid] });
    expect(() => makeSpectralScene(model)).toThrow(/non-passive/);
});
