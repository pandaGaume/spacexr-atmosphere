/** Three Cartesian or spectral components, ordered X/Y/Z or R/G/B as documented. */
export type Vector3 = readonly number[];
/** Renderer-neutral dimensions of an oblate ellipsoid, in metres. */
export interface IEllipsoidAxes {
    /** Equatorial semi-major axis, metres. */
    readonly semiMajorAxis: number;
    /** Polar semi-minor axis, metres. */
    readonly semiMinorAxis: number;
}
/** A medium bounded by a geodetic altitude above an ellipsoid. */
export interface IAtmosphericBounds {
    /** Ellipsoid dimensions, metres. */
    readonly ellipsoid: IEllipsoidAxes;
    /** Maximum geodetic altitude of the medium, metres. */
    readonly top: number;
}
/** Clipped segment along a unit ECEF ray, with physical distances in metres. */
export interface IAtmosphericInterval {
    /** Entry distance along the ray, metres. */
    readonly start: number;
    /** Exit distance or opaque surface distance, metres. */
    readonly end: number;
    /** Unit direction in ECEF, polar axis Z. */
    readonly direction: Vector3;
}
