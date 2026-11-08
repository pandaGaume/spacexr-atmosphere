@group(0) @binding(4) var atmosphere_lightOut:texture_storage_2d_array<rgba16float,write>;
@group(0) @binding(5) var atmosphere_transmissionOut:texture_storage_2d_array<rgba16float,write>;
@group(0) @binding(7) var<storage,read> atmosphere_horizon:array<f32>;
@compute @workgroup_size(8,4,1)
fn atmosphere_bake(@builtin(global_invocation_id) invocation:vec3u) {
    let id=vec3u(invocation.x,invocation.y+atmosphere_frame.quality.w,invocation.z);
    if any(id>=atmosphere_frame.size.xyz) { return; }
    let group=atmosphere_frame.size.w;
    let rows=atmosphere_frame.size.y/2u; let ground=id.y>=rows;
    let fraction=f32(id.y%rows)/f32(rows-1u); let h=atmosphere_horizon[id.x];
    let span=select(0.5*atmosphere_PI-h,h+0.5*atmosphere_PI,ground);
    var elevation=h+select(1.0,-1.0,ground)*span*fraction*fraction*fraction*fraction;

    let azimuth=f32(id.x)/f32(atmosphere_frame.size.x)*2.0*atmosphere_PI;
    let direction=normalize(sin(elevation)*atmosphere_frame.up.xyz+cos(elevation)*(cos(azimuth)*atmosphere_frame.east.xyz+sin(azimuth)*atmosphere_frame.north.xyz));
    let result=atmosphere_integrate(direction,group,select(0,select(1,-1,ground),id.y%rows==0u));
    textureStore(atmosphere_lightOut,vec2i(id.xy),i32(group),vec4f(result.light,1.0));
    textureStore(atmosphere_transmissionOut,vec2i(id.xy),i32(group),vec4f(result.transmission,1.0));
}
