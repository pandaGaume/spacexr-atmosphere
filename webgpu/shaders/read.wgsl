@group(0) @binding(4) var atmosphere_light:texture_2d_array<f32>;
@group(0) @binding(5) var atmosphere_transmission:texture_2d_array<f32>;
@group(0) @binding(6) var atmosphere_sampler:sampler;
@group(0) @binding(7) var<storage,read> atmosphere_horizon:array<f32>;
fn atmosphere_horizonAt(u:f32)->f32 {
    let width=arrayLength(&atmosphere_horizon); let x=fract(u)*f32(width); let left=u32(floor(x));
    return mix(atmosphere_horizon[left%width],atmosphere_horizon[(left+1u)%width],fract(x));
}
fn atmosphere_skyUv(d:vec3f)->vec2f {
    let azimuth=fract(atan2(dot(d,atmosphere_frame.north.xyz),dot(d,atmosphere_frame.east.xyz))/(2.0*atmosphere_PI)+1.0);
    let elevation=atan2(dot(d,atmosphere_frame.up.xyz),length(vec2f(dot(d,atmosphere_frame.east.xyz),dot(d,atmosphere_frame.north.xyz)))); let h=atmosphere_horizonAt(azimuth);
    let hit=atmosphere_intersect(atmosphere_cameraPoint(),d,1.0); let ground=hit.x>=-1e-6 && hit.y>=0.0;
    let rows=f32(atmosphere_frame.size.y/2u);
    let span=select(0.5*atmosphere_PI-h,h+0.5*atmosphere_PI,ground);
    var t=sqrt(sqrt(clamp(abs(elevation-h)/max(span,1e-6),0.0,1.0)));if abs(elevation-h)<2e-7 {t=0.0;}
    return vec2f(azimuth+0.5/f32(atmosphere_frame.size.x),(select(0.0,rows,ground)+t*(rows-1.0)+0.5)/f32(atmosphere_frame.size.y));
}
fn atmosphere_skyRadiance(directionEcef:vec3f)->vec3f {
    let uv=atmosphere_skyUv(normalize(directionEcef)); var xyz=vec3f(0.0);
    for(var g=0u;g<arrayLength(&atmosphere_spectrum);g++) {
        let band=atmosphere_spectrum[g]; xyz+=atmosphere_toXYZ(textureSampleLevel(atmosphere_light,atmosphere_sampler,uv,i32(g),0.0).xyz*band.atmosphere_solar.xyz,band);
    }
    return atmosphere_xyzToRgb(xyz);
}
fn atmosphere_transmittanceToSun(pRelativeToCameraMeters:vec3f,wavelengthGroup:u32)->vec3f {
    let delta=pRelativeToCameraMeters*0.001; let distance=length(delta);
    var p=atmosphere_cameraPoint(); if distance>0.0 { p=atmosphere_pointAdd(p,delta/distance,distance); }
    return atmosphere_solarDirect(p,atmosphere_spectrum[wavelengthGroup]);
}
