export const layerProfilesSource = `
struct LayerProfile { bounds:vec4f, shape:vec4f }
@group(0) @binding(14) var<storage,read> layerProfiles:array<LayerProfile>;
fn layerDensities(h:f32)->vec4f {
    var rho=vec4f(0.0);
    for(var i=0u;i<arrayLength(&layerProfiles);i++){
        let p=layerProfiles[i];
        if h>=p.bounds.x && h<p.bounds.y {
            let x=(h-p.bounds.z)/p.bounds.w;
            rho[i]=p.shape.x*select(exp(select(-x,-0.5*x*x,p.shape.y>1.5)),1.0,p.shape.y>0.5&&p.shape.y<1.5);
        }
    }
    return rho;
}
`;
export function layeredGeometry(base) {
    return base.replace(/fn density\(p: vec3f\) -> vec2f \{[\s\S]*?\n\}/,`fn density(p:vec3f)->vec4f {let h=altitude(p);if h<0.0||h>params.axesTop.z{return vec4f(0.0);}return layerDensities(h);}`)
        .replace(/fn extinction\(rho: vec2f\) -> vec3f \{[^\n]*\}/,'fn extinction(rho:vec4f)->vec3f {return vec3f(0.0);}')+layerProfilesSource;
}
/** Manually reject each shadowed interpolation corner before mixing four independent layer columns. */
export function layeredSolarSampling(source) {
    const begin=source.indexOf('    let columns = textureSampleLevel');
    return source.slice(0,begin)+`
    let dimensions=vec3i(textureDimensions(solarTexture));let pcoord=coord*vec3f(dimensions)-vec3f(0.5);
    let base=vec3i(floor(pcoord));let f=fract(pcoord);var columns=vec4f(0.0);
    for(var corner=0u;corner<8u;corner++){
        let shift=vec3i(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
        let weights=select(vec3f(1.0)-f,f,shift>vec3i(0));let weight=weights.x*weights.y*weights.z;
        if weight>1e-7 {
            let value=textureLoad(solarTexture,clamp(base+shift,vec3i(0),dimensions-vec3i(1)),0);
            if value.x<0.0 {return directSolar(p);}columns+=value*weight;
        }
    }
    let filtered=textureSampleLevel(solarTexture,solarSampler,coord,0.0);
    cacheHits++;return exp(-extinction(filtered));
}
`;
}
