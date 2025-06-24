precision mediump float; // Cuánta precisión flotante usa la GPU { highp , mediump , lowp }

uniform sampler2D currentState; // Amplitud actual del píxel de la imagen (buffer de entrada)
uniform sampler2D previousState; // Amplitud en el instante anterior del píxel de la imagen (buffer de entrada)
uniform float coeff; // Coeficiente de la PDE discretizada
uniform int boundaryType; // 0 = periodic, 1 = reflective
uniform int width;
uniform int height;

// Coordenadas de textura (UV) que vienen desde el vertex shader hacia el fragment shader
// Las variables varying se usan para pasar información del vertex shader al fragment shader
// En el vertex shader se calcula esta variable para cada vértice y aquí se interpolará para 
// cada fragmento (píxel)
// Las coordenadas UV están normalizadas en [0.0, 1.0]
varying vec2 vUv;

// Función principal del shader
void main() {
    // Convertir las coordenadas UV normalizadas a coordenadas de píxel enteras
    ivec2 coord = ivec2(vUv * vec2(width, height)); 
    
    // Obtener coordenadas enteras de vecinos 
    ivec2 left = coord - ivec2(1, 0);
    ivec2 right = coord + ivec2(1, 0);
    ivec2 up = coord - ivec2(0, 1);
    ivec2 down = coord + ivec2(0, 1);
    
    // Manejo de condiciones de frontera
    if (boundaryType == 0) { 
        // Periodic: que las posiciones fuera de rango se conecten al lado opuesto
        if (left.x < 0) left.x = width - 1;
        if (right.x >= width) right.x = 0;
        if (up.y < 0) up.y = height - 1;
        if (down.y >= height) down.y = 0;
    } else { 
        // Reflective: rebotar al llegar al borde  
        if (left.x < 0) left.x = 1;
        if (right.x >= width) right.x = width - 2;
        if (up.y < 0) up.y = 1;
        if (down.y >= height) down.y = height - 2;
    }
    
    // Convertir las oordenadas de los vecinos a UVs normalizadas
    vec2 uv = vUv;
    vec2 uv_left = vec2(left) / vec2(width, height);
    vec2 uv_right = vec2(right) / vec2(width, height);
    vec2 uv_up = vec2(up) / vec2(width, height);
    vec2 uv_down = vec2(down) / vec2(width, height);
    
    // Leer todos los valores muestreando desde la textura actual
    float center = texture2D(currentState, uv).r;
    float left_val = texture2D(currentState, uv_left).r;
    float right_val = texture2D(currentState, uv_right).r;
    float up_val = texture2D(currentState, uv_up).r;
    float down_val = texture2D(currentState, uv_down).r;

    // Leer el valor muestreando desde la textura anterior (leer buffer de entrada)
    float prev = texture2D(previousState, uv).r; 
    
    // Calcular laplaciano
    float laplacian = left_val + right_val + up_val + down_val - 4.0 * center;
    
    // Ecuación de onda: u^{n+1} = 2u^n - u^{n-1} + c^2 * dt^2 * ∇²u
    float next = 2.0 * center - prev + coeff * laplacian;
    
    // Escribir el resultado para este fragemnto/píxel como un color RGBA, donde el R contiene la info. útil (buffer de salida)
    gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
}