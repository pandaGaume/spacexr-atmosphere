// Distances are kilometres internally. Scaled ECEF coordinates use two floats.
struct atmosphere_Pair { hi: f32, lo: f32 }
struct atmosphere_Point { hi: vec3f, lo: vec3f }
struct atmosphere_AtmosphereFrame {
    originHi: vec4f, originLo: vec4f,
    inverseHi: vec4f, inverseLo: vec4f,
    sun: vec4f, east: vec4f, north: vec4f, up: vec4f,
    quality: vec4u, size: vec4u,
}
@group(0) @binding(0) var<uniform> atmosphere_frame: atmosphere_AtmosphereFrame;
fn atmosphere_pair(a: f32, b: f32) -> atmosphere_Pair {
    let s = a + b; let v = s - a;
    return atmosphere_Pair(s, (a - (s - v)) + (b - v));
}
fn atmosphere_add(a: atmosphere_Pair, b: atmosphere_Pair) -> atmosphere_Pair {
    let s = atmosphere_pair(a.hi, b.hi); return atmosphere_pair(s.hi, s.lo + a.lo + b.lo);
}
fn atmosphere_product(a:f32,b:f32)->atmosphere_Pair {
    let p=a*b;
    let ac=4097.0*a;let ah=ac-(ac-a);let al=a-ah;
    let bc=4097.0*b;let bh=bc-(bc-b);let bl=b-bh;
    return atmosphere_Pair(p,((ah*bh-p)+ah*bl+al*bh)+al*bl);
}
fn atmosphere_multiply(a: atmosphere_Pair, b: atmosphere_Pair) -> atmosphere_Pair {
    let p = atmosphere_product(a.hi,b.hi); return atmosphere_pair(p.hi,p.lo+a.hi*b.lo+a.lo*b.hi);
}
fn atmosphere_component(p: atmosphere_Point, i: u32) -> atmosphere_Pair { return atmosphere_Pair(p.hi[i],p.lo[i]); }
fn atmosphere_pointAdd(p: atmosphere_Point, d: vec3f, t: f32) -> atmosphere_Point {
    var out: atmosphere_Point;
    for(var i=0u;i<3u;i++) {
        let offset = atmosphere_multiply(atmosphere_product(d[i],t),atmosphere_Pair(atmosphere_frame.inverseHi[i],atmosphere_frame.inverseLo[i]));
        let v = atmosphere_add(atmosphere_component(p,i),offset); out.hi[i]=v.hi; out.lo[i]=v.lo;
    }
    return out;
}
fn atmosphere_pointDot(a: atmosphere_Point,b: atmosphere_Point) -> atmosphere_Pair {
    var s=atmosphere_Pair(0.0,0.0);
    for(var i=0u;i<3u;i++) { s=atmosphere_add(s,atmosphere_multiply(atmosphere_component(a,i),atmosphere_component(b,i))); }
    return s;
}
fn atmosphere_cameraPoint() -> atmosphere_Point { return atmosphere_Point(atmosphere_frame.originHi.xyz,atmosphere_frame.originLo.xyz); }
fn atmosphere_intersect(p: atmosphere_Point, d: vec3f, scale: f32) -> vec2f {
    var v:atmosphere_Point;
    for(var i=0u;i<3u;i++){let x=atmosphere_multiply(atmosphere_Pair(d[i],0.0),atmosphere_Pair(atmosphere_frame.inverseHi[i],atmosphere_frame.inverseLo[i]));v.hi[i]=x.hi;v.lo[i]=x.lo;}
    let aPair=atmosphere_pointDot(v,v);let a=aPair.hi+aPair.lo;
    let b=atmosphere_pointDot(p,v);
    let c=atmosphere_add(atmosphere_pointDot(p,p),atmosphere_Pair(-scale*scale,0.0));
    let disc=atmosphere_add(atmosphere_multiply(b,b),atmosphere_multiply(atmosphere_Pair(-aPair.hi,-aPair.lo),c));
    let delta=disc.hi+disc.lo;
    if delta<0.0 { return vec2f(1.0,-1.0); }
    let r=sqrt(delta); let bv=b.hi+b.lo;
    let stable=-bv-select(-r,r,bv>=0.0);
    if abs(stable)<1e-25 { return vec2f(-bv/a); }
    let t0=stable/a; let t1=(c.hi+c.lo)/stable;
    return vec2f(min(t0,t1),max(t0,t1));
}
fn atmosphere_altitude(p: atmosphere_Point) -> f32 {
    let inverse=atmosphere_frame.inverseHi.xyz;
    let normal=normalize(p.hi*inverse);
    let v=normal*inverse;
    let b=dot(p.hi,v);let a=dot(v,v);
    let c=atmosphere_add(atmosphere_pointDot(p,p),atmosphere_Pair(-1.0,0.0));
    let residual=c.hi+c.lo;
    // Stable small root of the normal-line ellipsoid intersection.
    return residual/(b+sqrt(max(0.0,b*b-a*residual)));
}
fn atmosphere_interval(p: atmosphere_Point,d: vec3f) -> vec2f {
    let outer=atmosphere_intersect(p,d,atmosphere_frame.inverseHi.w);
    var start=max(0.0,outer.x); var end=outer.y;
    let ground=atmosphere_intersect(p,d,1.0);
    if ground.y>=start {
        if ground.x>=start { end=min(end,ground.x); }
        else if ground.x>=-1e-6 && dot(p.hi,d*atmosphere_frame.inverseHi.xyz)<0.0 { end=start; }
    }
    return vec2f(start,end);
}
