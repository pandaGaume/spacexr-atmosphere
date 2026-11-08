import { ecefToGeodetic, geodeticPosition, dot, inside, intersectEllipsoid } from "../src/geometry";
import type { IEllipsoidAxes } from "../src/types";
import type { EcefVector, IAtmosphereCamera } from "./types";

/** Validates and copies a perspective camera, without GPU access. */
export function copyCamera(camera: IAtmosphereCamera, axes: IEllipsoidAxes): IAtmosphereCamera {
    const vectors = [camera.positionEcefMeters, camera.forwardEcef, camera.rightEcef, camera.upEcef];
    if (vectors.some((v) => v.length !== 3 || !v.every(Number.isFinite))) throw new Error("Camera requires finite ECEF triples");
    const [forward, right, up] = vectors.slice(1);
    if (
        [forward, right, up].some((v) => Math.abs(dot(v, v) - 1) > 1e-6) ||
        Math.abs(dot(forward, right)) > 1e-6 ||
        Math.abs(dot(forward, up)) > 1e-6 ||
        Math.abs(dot(right, up)) > 1e-6
    )
        throw new Error("Camera basis must be orthonormal");
    const cross = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
    if (cross.some((v, i) => Math.abs(v + forward[i]) > 1e-6)) throw new Error("Camera basis handedness is invalid");
    let position: [number, number, number] = [...camera.positionEcefMeters];
    if (inside(axes, position)) {
        const geo = ecefToGeodetic(axes, { x: position[0], y: position[1], z: position[2] });
        if (geo.height < -1e-5) throw new Error("Camera is underground");
        position = geodeticPosition(axes, geo.latitude, geo.longitude, 1e-6) as [number, number, number];
    }
    if (
        ![camera.halfWidthTangent, camera.halfHeightTangent].every((v) => Number.isFinite(v) && v > 0) ||
        ![camera.viewportWidth, camera.viewportHeight].every((v) => Number.isSafeInteger(v) && v > 0)
    )
        throw new Error("Invalid camera projection or viewport");
    return {
        ...camera,
        positionEcefMeters: position,
        forwardEcef: [...camera.forwardEcef],
        rightEcef: [...camera.rightEcef],
        upEcef: [...camera.upEcef],
    };
}

/** Local tangent frame and double-precision ellipsoidal horizon at each azimuth. */
export function horizonMetadata(axes: IEllipsoidAxes, origin: EcefVector, width: number) {
    const geo = ecefToGeodetic(axes, { x: origin[0], y: origin[1], z: origin[2] }),
        lat = geo.latitude,
        lon = geo.longitude;
    const east = [-Math.sin(lon), Math.cos(lon), 0],
        north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
        up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const horizon = new Float32Array(width);
    for (let x = 0; x < width; x++) {
        const azimuth = (x / width) * 2 * Math.PI;
        let low = -Math.PI / 2,
            high = 0;
        for (let k = 0; k < 48; k++) {
            const elevation = (low + high) / 2;
            const d = up.map(
                (v, i) => v * Math.sin(elevation) + Math.cos(elevation) * (Math.cos(azimuth) * east[i] + Math.sin(azimuth) * north[i]),
            );
            const hit = intersectEllipsoid(axes, origin, d);
            if (hit && hit[0] >= 0) low = elevation;
            else high = elevation;
        }
        horizon[x] = (low + high) / 2;
    }
    return { east, north, up, horizon, height: Math.max(0, geo.height) };
}

/** Splits a CPU number into a float32 high component and its residual. */
export function split(value: number): readonly [number, number] {
    const hi = Math.fround(value);
    return [hi, Math.fround(value - hi)];
}
