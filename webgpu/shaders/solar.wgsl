
@group(0) @binding(4) var solarOutput:texture_storage_3d<rgba32float,write>;
@group(0) @binding(9) var<storage,read> solarPoints:array<vec4f>;
@compute @workgroup_size(8,4,1)
fn atmosphere_bakeSolar(@builtin(global_invocation_id) invocation:vec3u) {
    let id=vec3u(invocation.x,invocation.y+atmosphere_frame.quality.w,invocation.z+atmosphere_frame.quality.z);
    let dims=textureDimensions(solarOutput);if any(id>=dims) {return;}
    let index=(id.z*dims.y+id.y)*dims.x+id.x;
    let p=atmosphere_Point(solarPoints[2u*index].xyz,solarPoints[2u*index+1u].xyz);
    let direction=atmosphere_frame.sun.xyz;let ground=atmosphere_intersect(p,direction,1.0);
    if ground.y>1e-7 && ground.x>=-1e-7 {textureStore(solarOutput,vec3i(id),vec4f(-1.0));return;}
    let outer=atmosphere_intersect(p,direction,atmosphere_frame.inverseHi.w);let start=max(0.0,outer.x);let end=max(start,outer.y);
    let count=atmosphere_frame.quality.y;let ds=(end-start)/f32(count);var col=vec4f(0.0);
    for(var i=0u;i<count;i++){col+=atmosphere_density(atmosphere_pointAdd(p,direction,start+(f32(i)+0.5)*ds))*ds;}
    textureStore(solarOutput,vec3i(id),col);
}
