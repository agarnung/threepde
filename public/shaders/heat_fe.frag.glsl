precision mediump float;

uniform sampler2D currentState; // Estado actual (u^n) (buffer de entrada)
uniform float coeff;   // Coeficiente de difusión (α * Δt / Δx²)
uniform float dt;               
uniform int boundaryType;       // 0 = periódico, 1 = reflectivo
uniform int width;
uniform int height;

varying vec2 vUv;

void main() {
    // Convertir UV a coordenadas de píxel
    ivec2 coord = ivec2(vUv * vec2(width, height));
    
    // Coordenadas de vecinos
    ivec2 left = coord - ivec2(1, 0);
    ivec2 right = coord + ivec2(1, 0);
    ivec2 up = coord - ivec2(0, 1);
    ivec2 down = coord + ivec2(0, 1);
    
    if (boundaryType == 0) { // Periódico
        if (left.x < 0) left.x = width - 1;
        if (right.x >= width) right.x = 0;
        if (up.y < 0) up.y = height - 1;
        if (down.y >= height) down.y = 0;
    } else { // Reflectivo
        if (left.x < 0) left.x = 1;
        if (right.x >= width) right.x = width - 2;
        if (up.y < 0) up.y = 1;
        if (down.y >= height) down.y = height - 2;
    }
    
    // Convertir a UVs normalizadas
    vec2 uv = vUv;
    vec2 uv_left = vec2(left) / vec2(width, height);
    vec2 uv_right = vec2(right) / vec2(width, height);
    vec2 uv_up = vec2(up) / vec2(width, height);
    vec2 uv_down = vec2(down) / vec2(width, height);
    
    float center = texture2D(currentState, uv).r;
    float left_val = texture2D(currentState, uv_left).r;
    float right_val = texture2D(currentState, uv_right).r;
    float up_val = texture2D(currentState, uv_up).r;
    float down_val = texture2D(currentState, uv_down).r;

    float laplacian = left_val + right_val + up_val + down_val - 4.0 * center;
    
    float next = center + coeff * laplacian;
    
    gl_FragColor = vec4(next, 0.0, 0.0, 1.0); // (buffer de salida)
}