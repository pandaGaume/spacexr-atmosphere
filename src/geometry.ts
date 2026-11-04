import { Ellipsoid, GeodeticSystem } from "@spacexr/geodesy";
import type { ICartesian3, IGeodeticCoordinates } from "@spacexr/geodesy";
import type { IEllipsoidAxes, IAtmosphericBounds, IAtmosphericInterval, Vector3 } from "./types";
/** Internal scratch storage is reused during synchronous geodetic conversions. */
interface ISystemCache {
    major: number;
    minor: number;
    system: GeodeticSystem;
    position: ICartesian3;
    geographic: IGeodeticCoordinates;
}
const systems = new WeakMap<IEllipsoidAxes, ISystemCache>();
function systemFor(axes: IEllipsoidAxes): ISystemCache {
    let entry = systems.get(axes);
    if (!entry || entry.major !== axes.semiMajorAxis || entry.minor !== axes.semiMinorAxis) {
        validateEllipsoid(axes);
        const ellipsoid = axes instanceof Ellipsoid ? axes : Ellipsoid.fromAxes("Atmosphere", axes.semiMajorAxis, axes.semiMinorAxis);
        entry = {
            major: axes.semiMajorAxis,
            minor: axes.semiMinorAxis,
            system: new GeodeticSystem(ellipsoid),
            position: { x: 0, y: 0, z: 0 },
            geographic: { latitude: 0, longitude: 0, height: 0 },
        };
        systems.set(axes, entry);
    }
    return entry;
}
/** Converts geodetic radians and height in metres to ECEF using the npm geodesy implementation.
 * A caller-supplied Cartesian target is populated without allocating an output object.
 */
export function geodeticToEcef(
    axes: IEllipsoidAxes,
    latitudeRadians: number,
    longitudeRadians: number,
    height = 0,
    target?: ICartesian3,
): ICartesian3 {
    return systemFor(axes).system.geodeticRadiansToEcef(latitudeRadians, longitudeRadians, height, target);
}
/** Refines the geodesy result only for strongly flattened synthetic bodies, using geodesy's forward surface and curvature APIs. */
function refinedGeodetic(entry: ISystemCache, position: ICartesian3, target: IGeodeticCoordinates): IGeodeticCoordinates {
    const result = entry.system.ecefToGeodeticRadians(position, target);
    if (entry.minor / entry.major > 0.9) return result;
    const surface = { x: 0, y: 0, z: 0 },
        lon = result.longitude;
    for (let i = 0; i < 8; i++) {
        const lat = result.latitude,
            s = Math.sin(lat),
            c = Math.cos(lat),
            cl = Math.cos(lon),
            sl = Math.sin(lon);
        entry.system.geodeticRadiansToEcef(lat, lon, 0, surface);
        const dx = position.x - surface.x,
            dy = position.y - surface.y,
            dz = position.z - surface.z;
        const height = dx * c * cl + dy * c * sl + dz * s,
            tangent = -dx * s * cl - dy * s * sl + dz * c;
        const step = tangent / (entry.system.ellipsoid.meridionalRadius(lat) + height);
        result.height = height;
        if (Math.abs(step) < 1e-14) break;
        result.latitude += step;
    }
    return result;
}
/** Converts an ECEF object in metres to geodetic radians through @spacexr/geodesy. */
export function ecefToGeodetic(axes: IEllipsoidAxes, position: ICartesian3, target?: IGeodeticCoordinates): IGeodeticCoordinates {
    return refinedGeodetic(systemFor(axes), position, target ?? { latitude: 0, longitude: 0, height: 0 });
}
/** ECEF coordinates and physical distances use meters. Z is the polar axis. */
export const WGS84 = Object.freeze({ semiMajorAxis: Ellipsoid.WGS84.semiMajorAxis, semiMinorAxis: Ellipsoid.WGS84.semiMinorAxis });
/** Adds two three-component ECEF or spectral arrays. */
export const add = (a: Vector3, b: Vector3) => a.map((x, i) => x + b[i]);
/** Scales a three-component array. */
export const mul = (a: Vector3, s: number) => a.map((x) => x * s);
/** Dot product of three-component arrays. */
export const dot = (a: Vector3, b: Vector3) => a.reduce((s, x, i) => s + x * b[i], 0);
/** Euclidean length of a three-component array. */
export const norm = (a: Vector3) => Math.hypot(...a);
/** Normalizes a finite three-component direction. */
export function normalize(a: Vector3) {
    if (a.length !== 3 || !a.every(Number.isFinite)) throw new Error("Expected three finite ECEF components");
    const n = norm(a);
    if (!(n > 0) || !Number.isFinite(n)) throw new Error("Invalid direction");
    return mul(a, 1 / n);
}
/** Samples an ECEF ray at a distance in metres. */
export const along = (o: Vector3, d: Vector3, t: number) => add(o, mul(d, t));
/** Validates positive finite oblate ellipsoid axes in metres. */
export function validateEllipsoid(e: IEllipsoidAxes) {
    if (!(e.semiMajorAxis >= e.semiMinorAxis && e.semiMinorAxis > 0) || !Number.isFinite(e.semiMajorAxis)) {
        throw new Error("Expected finite oblate ellipsoid axes in meters");
    }
}
/** Convenience ECEF array from latitude/longitude in radians and height in metres. */
export function geodeticPosition(e: IEllipsoidAxes, latitude: number, longitude: number, height: number): number[] {
    const entry = systemFor(e);
    const p = entry.system.geodeticRadiansToEcef(latitude, longitude, height, entry.position);
    return [p.x, p.y, p.z];
}
/** Geodetic latitude and longitude in radians, exterior height in metres, interior height classified as -1. */
export function geographicCoordinates(e: IEllipsoidAxes, p: Vector3): IGeodeticCoordinates {
    const entry = systemFor(e);
    entry.position.x = p[0];
    entry.position.y = p[1];
    entry.position.z = p[2];
    if (inside(e, p)) return { latitude: 0, longitude: Math.atan2(p[1], p[0]), height: -1 };
    const value = refinedGeodetic(entry, entry.position, entry.geographic);
    return { latitude: value.latitude, longitude: value.longitude, height: Math.max(0, value.height) };
}
/** Classifies points strictly inside an ellipsoid. */
export function inside(e: IEllipsoidAxes, p: Vector3) {
    return (p[0] / e.semiMajorAxis) ** 2 + (p[1] / e.semiMajorAxis) ** 2 + (p[2] / e.semiMinorAxis) ** 2 < 1;
}
/** Exterior geodetic altitude via closest-point projection. No radial-radius approximation.
 * Interior is only classified, never used to integrate atmospheric density.
 */
export function altitude(e: IEllipsoidAxes, p: Vector3): number {
    if (inside(e, p)) return -1;
    const entry = systemFor(e);
    entry.position.x = p[0];
    entry.position.y = p[1];
    entry.position.z = p[2];
    return Math.max(0, refinedGeodetic(entry, entry.position, entry.geographic).height);
}
/** Stable quadratic. Direction is not rescaled, so returned t retains physical units. */
export function intersectEllipsoid(e: IEllipsoidAxes, o: Vector3, d: Vector3, scale = 1): [number, number] | null {
    const axes = [e.semiMajorAxis * scale, e.semiMajorAxis * scale, e.semiMinorAxis * scale];
    const q = o.map((v, i) => v / axes[i]),
        v = d.map((x, i) => x / axes[i]);
    const A = dot(v, v),
        B = 2 * dot(q, v),
        C = dot(q, q) - 1;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const root = Math.sqrt(disc),
        t = -0.5 * (B + (B < 0 ? -root : root));
    if (t === 0) return [-B / (2 * A), -B / (2 * A)];
    const x = t / A,
        y = C / t;
    return [Math.min(x, y), Math.max(x, y)];
}
/** Homothetic envelope contains the geodetic offset surface, but does not define density. */
export const envelopeScale = (e: IEllipsoidAxes, height: number) => 1 + height / e.semiMinorAxis;
/** Clips an ECEF ray to atmosphere and ground, returning distances in metres. */
export function atmosphericInterval(
    model: IAtmosphericBounds,
    o: Vector3,
    direction: Vector3,
    maxDistance = Infinity,
): IAtmosphericInterval | null {
    const d = normalize(direction),
        e = model.ellipsoid;
    if (inside(e, o)) return null;
    const outer = intersectEllipsoid(e, o, d, envelopeScale(e, model.top));
    if (!outer) return null;
    const start = Math.max(0, outer[0]);
    let end = Math.min(maxDistance, outer[1]);
    const ground = intersectEllipsoid(e, o, d);
    if (ground && ground[1] >= start) {
        if (ground[0] >= start) end = Math.min(end, ground[0]);
        else if (
            ground[0] >= -1e-6 &&
            dot(
                o.map((x, i) => x / (i === 2 ? e.semiMinorAxis ** 2 : e.semiMajorAxis ** 2)),
                d,
            ) < 0
        )
            end = start;
    }
    return end > start ? { start, end, direction: d } : null;
}
