// Fragment shader para la resolución de un paso de la ecuación de onda con esquema de euler hacia delante
// El shader se debería de cargar desde solver.js dinámicamente

precision highp float;

uniform sampler2D u_current;
uniform sampler2D u_previous;
uniform vec2 resolution;
uniform float c;
uniform float dt;
uniform float dx;
uniform int boundaryType; // 0 = reflective, 1 = periodic

void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    vec2 pixelSize = 1.0 / resolution;
    
    // Manejo de bordes
    vec2 coord = gl_FragCoord.xy;
    
    // Obtener valores actuales y anteriores
    float u = texture2D(u_current, uv).r;
    float u_prev = texture2D(u_previous, uv).r;
    
    // Obtener vecinos con manejo de bordes
    float up, down, left, right;
    
    if (boundaryType == 1) {
        // Bordes periódicos
        up = texture2D(u_current, uv + vec2(0.0, pixelSize.y)).r;
        down = texture2D(u_current, uv - vec2(0.0, pixelSize.y)).r;
        left = texture2D(u_current, uv - vec2(pixelSize.x, 0.0)).r;
        right = texture2D(u_current, uv + vec2(pixelSize.x, 0.0)).r;
    } else {
        // Bordes reflectivos (Neumann)
        vec2 upCoord = uv + vec2(0.0, pixelSize.y);
        vec2 downCoord = uv - vec2(0.0, pixelSize.y);
        vec2 leftCoord = uv - vec2(pixelSize.x, 0.0);
        vec2 rightCoord = uv + vec2(pixelSize.x, 0.0);
        
        // Asegurar que no salgamos de los límites
        upCoord.y = min(upCoord.y, 1.0 - pixelSize.y);
        downCoord.y = max(downCoord.y, pixelSize.y);
        leftCoord.x = max(leftCoord.x, pixelSize.x);
        rightCoord.x = min(rightCoord.x, 1.0 - pixelSize.x);
        
        up = texture2D(u_current, upCoord).r;
        down = texture2D(u_current, downCoord).r;
        left = texture2D(u_current, leftCoord).r;
        right = texture2D(u_current, rightCoord).r;
    }
    
    // Calcular Laplaciano
    float laplacian = (up + down + left + right - 4.0 * u) / (dx * dx);
    
    // Ecuación de onda: ∂²u/∂t² = c²∇²u
    float next = 2.0 * u - u_prev + (c * c) * (dt * dt) * laplacian;
    
    // Clamping
    next = clamp(next, 0.0, 1.0);
    
    gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
}