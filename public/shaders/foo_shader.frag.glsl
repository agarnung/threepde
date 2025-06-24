uniform sampler2D currentState;
uniform float width;
uniform float height;

varying vec2 vUv;

void main() {
    // Obtener coordenadas normalizadas
    vec2 uv = vUv;
    
    // Leer valor actual (canal rojo = escala de grises)
    float current = texture2D(currentState, uv).r;
    
    // Invertir valor
    float inverted = 1.0 - current;
    
    // Salida RGB con el mismo valor invertido
    gl_FragColor = vec4(vec3(inverted), 1.0);
}