/// <reference types="@webgpu/types" />
import type { IPhysicalAtmosphereConfig } from "../src/spectrum";

/** Three finite Cartesian components, in the documented ECEF basis. */
export type EcefVector = readonly [number, number, number];
/** One perspective view; public distances are metres and angles are radians. */
export interface IAtmosphereCamera {
    /** CPU double-precision position; ECEF Z is the polar axis. */
    readonly positionEcefMeters: EcefVector;
    /** Unit direction into the scene. */
    readonly forwardEcef: EcefVector;
    /** Unit screen-right direction. */
    readonly rightEcef: EcefVector;
    /** Unit screen-up direction; cross(right, up) equals -forward. */
    readonly upEcef: EcefVector;
    /** Positive tangent of half the horizontal field of view. */
    readonly halfWidthTangent: number;
    /** Positive tangent of half the vertical field of view. */
    readonly halfHeightTangent: number;
    /** Physical viewport width in pixels. */
    readonly viewportWidth: number;
    /** Physical viewport height in pixels. */
    readonly viewportHeight: number;
}
/** Fixed per-instance spectral and lookup-table quality. */
export interface IAtmosphereSkyOptions extends Pick<
    IPhysicalAtmosphereConfig,
    "source" | "starTemperature" | "distanceAU" | "bandCenter" | "bandWidth" | "wavelengths"
> {
    /** Azimuth texels, from 8 to 1024; default 64. */
    readonly width?: number;
    /** Rows on each side of the horizon, from 4 to 256; default 64. */
    readonly hemisphereRows?: number;
    /** View quadrature steps, from 8 to 2048; default 256. */
    readonly viewSteps?: number;
    /** Direct solar quadrature steps, from 8 to 1024; default 192. */
    readonly solarSteps?: number;
}
/** Borrowed read-only resources. Valid until the owning sky is disposed. */
export interface IAtmosphereSkyBindings {
    /** Explicit group-0 layout used in the host pipeline layout. */
    readonly layout: GPUBindGroupLayout;
    /** Complete reader bind group, at group 0. */
    readonly group: GPUBindGroup;
    /** Stable for the instance lifetime; compare the owner as well as this value. */
    readonly generation: number;
    /** Spectral path radiance, rgba16float 2d-array, one slice per wavelength triple. */
    readonly radiance: GPUTextureView;
    /** Spectral path transmission, rgba16float 2d-array. */
    readonly transmission: GPUTextureView;
    /** Four layer-density columns in kilometres, rgba32float 3d; negative first component marks shadow. */
    readonly solarColumns: GPUTextureView;
    /** Resolved spectral wavelength count. */
    readonly wavelengths: number;
}
