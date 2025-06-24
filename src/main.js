import * as THREE from 'three';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { preprocessImageToGrayscale } from './helpers/image-preprocessor.js';
import { getHeightMapFromImageData, createHeightMesh } from './helpers/image-mesh-converter.js';
import { Solver } from './solver.js';
import { colors255, applyColormap, applyOriginalLabColormapToImage, applyOriginalLabColormapToImageFullRes, labToRgb } from './helpers/color-maps.js'

// Variables globales
let runSimulation = false;
let solver;
let originalImageData; // u_0
let Nx = 256, Ny = 256;
let meshGeometry; // Dónde están los vértices de tu superficie 3D que representan la altura de cada píxel
let positionAttribute; // Buffer (que el solver utiliza) que guarda los coordenadas (x, y, z) de cada vértice 
let currentImageData; // Imagen en cada paso, que se muestra en canvas2d
let needToUpdate = false; 
let meshGroup; // Mesh + wireframe
let toggledE = false; // Modo pantalla pseudo-completa con la tecla E
let currentColormapId = 'viridiscmap'
let originalWidth, originalHeight;
let originalL = null;
let originala = null;
let originalb = null;
let originalR = null;
let originalG = null;
let originalB_ = null;
let normalizeHeights = false; // Normalización de la altura de la malla en cada paso (efecto visual)
let lastTime = 0;
let speedAnimation = 50;
let useGPUSolver = false;

// Enlaczar elementos UI
const wireframeCheck = document.getElementById("wireframe-check");
const meshCheck = document.getElementById("mesh-check");
const runCheck = document.getElementById("run-check");
const canvas3dContainer = document.getElementById('canvas3d-container');
const originalZ = window.getComputedStyle(canvas3dContainer).zIndex || '0';
const fileUpload = document.getElementById('file-upload');
const boundarySelect = document.getElementById("boundary-select");
const pdeSelect = document.getElementById("pde-select");
const schemeSelect = document.getElementById("scheme-select");
const colormapSelect = document.getElementById("colormap-select");
const resetButton = document.getElementById("reset-button");
const velocitySlider = document.getElementById('speed-slider');
const velocityValue = document.getElementById('velocity-value');

// Event listeners
window.addEventListener('resize', handleResize);
wireframeCheck.addEventListener("change", toggleWireframe);
meshCheck.addEventListener("change", toggleMesh);
runCheck.addEventListener("change", toggleRun);
fileUpload.addEventListener('change', handleImageUpload);
boundarySelect.addEventListener("change", handleBoundaryChange);
pdeSelect.addEventListener("change", handlePDEChange);
schemeSelect.addEventListener("change", handleSchemeChange);
colormapSelect.addEventListener("change", handleColormapChange);
resetButton.addEventListener("click", setInitialCondition);
velocitySlider.addEventListener("input", setVelocity);

// ==================================================
// INITIALIZE APPLICATION
// ==================================================
if (!isWebGL2Supported()) {
    console.error("[Main] WebGL2 no disponible - GPU deshabilitada");
    useGPUSolver = false;
} else {
    console.log("[Main] WebGL2 disponible");
}

// Configuración canvas 2D
const canvas2d = document.getElementById("canvas2d");
const ctx2d = canvas2d.getContext("2d");

// Configuración del canvas de Three.js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121212);

// Configurar luz 
const light = new THREE.DirectionalLight(0xffffff, 0.75);
light.position.set(0, 5, 0);
scene.add(light);
const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
light2.position.set(0, -5, 0);
scene.add(light2);

// Configuración inicial de cámara
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 7.5, 5);

// Configurar el renderer WebGL con nuestro canvas
const canvas3d = document.getElementById("canvas3d");
const renderer = new THREE.WebGLRenderer({ 
    antialias: false, // Disable antialiasing for better performance
    canvas: canvas3d,
    powerPreference: "high-performance" // Prioritize performance over power saving
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// Configurar control de la cámara
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // movimiento suave
controls.dampingFactor = 0.15;

// Configurar ejes del mundo personalizados
const axes = createAxes();
scene.add(axes.x);
scene.add(axes.y);
scene.add(axes.z);

// Cargar imagen 2D por defecto de public/ o crear imagen 2D de muestra sintética
{
    // img = new Image();
    // img.src = 'public/images/lena_rgb.webp';
    // img.onload = () => { // Esperar a que se cargue imagen para continuar
    //     originalImageData = preprocessImageToGrayscale(img);
    //     currentImageData = originalImageData;
    //     initializeSimulation();
    // };
}
{
    originalWidth = Nx;
    originalHeight = Ny;
    originalImageData = createSampleImage();
    currentImageData = originalImageData;

    const totalPixels = Nx * Ny;
    originalL = currentImageData;
    originala = new Float32Array(totalPixels).fill(0);
    originalb = new Float32Array(totalPixels).fill(0);
    originalR = new Float32Array(totalPixels);
    originalG = new Float32Array(totalPixels);
    originalB_ = new Float32Array(totalPixels);
    const data = originalImageData.data;
    for (let i = 0; i < totalPixels; i++) {
        originalR[i] = data[i * 4];
        originalG[i] = data[i * 4 + 1];
        originalB_[i] = data[i * 4 + 2];
    }
    initializeSimulation();
}

// Usar Stats.js para mostrar los FPS y modifica directamente en inline el estilo
const stats = new Stats();
stats.showPanel(0); // 0 = FPS, 1 = ms, 2 = MB, 3 = custom
stats.dom.style.position = 'fixed';
stats.dom.style.left = 'auto';    
stats.dom.style.top = 'auto';   
stats.dom.style.right = '0px';   
stats.dom.style.bottom = '0px';  
stats.dom.classList.add('stats');
document.body.appendChild(stats.dom);
// ==================================================
// END INITIALIZE APPLICATION
// ==================================================

animate();

// Bucle de animación principal, que se llama continuamente gracias a requestAnimationFram, que pide que se 
// ejecute la función que se le pase antes del siguiente repintado de pantalla.
// El solver debería devolver un ImageData tanto en CPU como en GPU
function animate(time = 0) {
    stats.begin();

    controls.update();

    const thresholdToHighSpeed = 50;
    if (runSimulation && solver) {
        if (speedAnimation === 0) {
            // No avanza la simulación
        } else if (speedAnimation <= thresholdToHighSpeed) {
            // Más lento, ejecuta cada cierto tiempo
            // Intervalo entre pasos: de 1000 ms (speed=1) a 20 ms (speed=thresholdToHighSpeed)
            const maxInterval = 1000;
            const minInterval = 20;
            const interval = maxInterval - ((speedAnimation - 1) / (thresholdToHighSpeed - 1)) * (maxInterval - minInterval);
            
            if (time - lastTime > interval) {
                currentImageData = solver.step();
                needToUpdate = true;
                lastTime = time;
            }
        } else {
            // Más rápido, ejecuta varios pasos por frame
            // stepsPerFrame: de 1 (speed=thresholdToHighSpeed) a 10 (speed=100)
            const minSteps = 1;
            const maxSteps = 10;
            const stepsPerFrame = Math.round(minSteps + ((speedAnimation - (thresholdToHighSpeed + 1)) / (thresholdToHighSpeed - 1)) * (maxSteps - minSteps));
            
            for (let i = 0; i < stepsPerFrame; i++) {
                currentImageData = solver.step();
            }
            needToUpdate = true;
        }
    }

    if (needToUpdate) {
        // Update simulation
        updateVisuals(currentImageData);
        positionAttribute.needsUpdate = true;
        meshGeometry.computeVertexNormals();
        needToUpdate = false;
    }

    // Render main scene
    renderer.render(scene, camera);

    stats.end();

    // Request next frame immediately
    requestAnimationFrame(animate);
}

// Helper functions
function initializeSimulation() {
    // Disparar los eventos para inializar el sistema
    // wireframeCheck.dispatchEvent(new Event('change'));
    meshCheck.dispatchEvent(new Event('change'));
    runCheck.dispatchEvent(new Event('change'));

    solver = new Solver({
        imageData: currentImageData,
        deltaPx: 1.0, // deltaPx == deltaX = deltaY
        dt: 0.005,
        pdeType: document.getElementById('pde-select').value || 'heat',
        boundaryType: document.getElementById('boundary-select').value || 'reflective',
        schemeType: document.getElementById('scheme-select').value || 'forward-euler',
        useGPU: false,
        renderer: renderer
    });

    updateVisuals(currentImageData);
}

// Cargar textura de ejemplo
function createSampleImage() {
    const canvas = document.createElement('canvas');
    canvas.width = Nx;
    canvas.height = Ny;
    
    // Usar el contexto del canvas temporal, no el global ctx2d
    const ctx = canvas.getContext('2d');
    
    // Fondo degradado
    const gradient = ctx.createRadialGradient(Nx / 2, Ny / 2, 0, Nx / 2, Ny / 2, Nx / 2);
    gradient.addColorStop(0, '#444');
    gradient.addColorStop(1, '#111');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, Nx, Ny);

    // Patrón de prueba
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Nx / 2, Ny / 2, Nx / 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(Nx - 10, Ny - 10);
    ctx.moveTo(Nx - 10, 10);
    ctx.lineTo(10, Ny - 10);
    ctx.stroke();

    return ctx.getImageData(0, 0, Nx, Ny);
}

// Actualizar tanto canvas2d (imagen) y canvas3d (heightmap/malla)
function updateVisuals(imageData) {
    // Generar heightmap y actualizar malla 3D
    const heightMapFlat = getHeightMapFromImageData(imageData, Nx, Ny);

    // Aplicar colormap SOLO para visualización y actualizar canvas 2D con imagen coloreada
    if (currentColormapId === 'constant-color') { 
        // Construir ImageData con RGB original
        const totalPixels = originalWidth * originalHeight;
        const imgDataArray = new Uint8ClampedArray(totalPixels * 4);
        for (let i = 0; i < totalPixels; i++) {
            imgDataArray[i * 4] = originalR[i];
            imgDataArray[i * 4 + 1] = originalG[i];
            imgDataArray[i * 4 + 2] = originalB_[i];
            imgDataArray[i * 4 + 3] = 255;
        }
        const originalRGBImageData = new ImageData(imgDataArray, originalWidth, originalHeight);
        updateCanvas2D(originalRGBImageData);
    } else {
        const coloredImageData = currentColormapId === 'constant-chrominance'
            ? applyOriginalLabColormapToImage(imageData, originala, originalb, originalWidth, originalHeight)
            : applyColormap(imageData, currentColormapId);
        updateCanvas2D(coloredImageData);
    }

    if (!meshGroup) {
        // Crear malla por primera vez
        meshGroup = createHeightMesh(heightMapFlat, Nx, Ny, false, 1, false, false);
        scene.add(meshGroup);
        const mesh = meshGroup.getObjectByName('mesh');
        if (mesh) mesh.visible = meshCheck.checked; 
        meshGeometry = mesh.geometry;
        positionAttribute = meshGeometry.attributes.position;
        const wireframe = meshGroup.getObjectByName("wireframe"); // Configurar wireframe inicial
        if (wireframe) wireframe.visible = wireframeCheck.checked;
    } else {
        // Actualizar malla existente (incluyendo wireframe)
        updateMeshGeometry(heightMapFlat);
    }

    // Actualizar colores (DESPUÉS de haber computado las altura con la imagen en gris, 
    // que es en la que se resuelve la PDE) de vértices para la malla 3D
    updateMeshColors(heightMapFlat, currentColormapId);
}

function updateMeshGeometry(heightMapFlat) {
    const posArr = positionAttribute.array;

    if (posArr.length !== Nx * Ny * 3) {
        console.error("Tamaño de los datos no coincide con la geometría.");
        return;
    }

    if (normalizeHeights) {
        // Cálculo de rango dinámico (sin percentiles... ver createHeightMesh())
        let min, max, range;
        // min = Math.min(...heightMapFlat);
        // max = Math.max(...heightMapFlat);
        max = heightMapFlat.reduce((a, b) => Math.max(a, b), -Infinity);
        min = heightMapFlat.reduce((a, b) => Math.min(a, b), Infinity);
        range = max - min || 1; // Evitar división por cero

        // Actualizar directamente la componente Z (altura) en el array con normalización
        for (let j = 0; j < Ny; j++) {
            for (let i = 0; i < Nx; i++) {
                const index = j * Nx + i;
                const arrayIndex = index * 3;
                const normalizedHeight = (heightMapFlat[index] - min) / range;
                const height = normalizedHeight * 1.0;
                posArr[arrayIndex + 2] = height;
            }
        }
    } else {
        // Actualizar directamente la componente Z (altura) en el array sin normalización
        for (let j = 0; j < Ny; j++) {
            for (let i = 0; i < Nx; i++) {
                const index = j * Nx + i;
                const arrayIndex = index * 3;
                posArr[arrayIndex + 2] = heightMapFlat[index];
            }
        }
    }

    meshGeometry.computeVertexNormals();

    // Actualizar wireframe
    const wireframe = meshGroup.getObjectByName("wireframe");
    if (wireframe) {
        wireframe.geometry.attributes.position.copy(positionAttribute);
        wireframe.geometry.attributes.position.needsUpdate = true;
        wireframe.geometry.computeVertexNormals();
    }

    needToUpdate = true;
}

function updateCanvas2D(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    canvas2d.width = w;
    canvas2d.height = h;
    ctx2d.putImageData(imageData, 0, 0);
}

function updateMeshColors(heightMapFlat, colormapId) {
    if (!meshGeometry || !meshGeometry.attributes.color) return;
    
    if (!meshGeometry.attributes.color) { // Si no existe el atributo color, lo creamos
        const colors = new Float32Array(Nx * Ny * 3);
        meshGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const colorAttribute = meshGeometry.attributes.color;
    const colorArr = colorAttribute.array;

    if (colormapId === 'constant-color' || colormapId === 'constant-chrominance') {
        for (let j = 0; j < Ny; j++) {
            for (let i = 0; i < Nx; i++) {
                const meshIndex = j * Nx + i;
                const arrayIndex = meshIndex * 3;   // Índice para la malla, de tamaño NxxNy

                // Calcular posición relativa en la imagen original
                const relX = i / (Nx - 1);
                const relY = j / (Ny - 1);
                
                // Mapear a coordenadas de la imagen original, de tamaño originalWidthxoriginalHeight
                const origX = Math.floor(relX * (originalWidth - 1));
                const origY = Math.floor(relY * (originalHeight - 1));
                const origIndex = origY * originalWidth + origX;

                if (colormapId === 'constant-color') {
                    // A Three.js se le pasan colores en [0, 1]
                    colorArr[arrayIndex] = originalR[origIndex] / 255.0;
                    colorArr[arrayIndex + 1] = originalG[origIndex] / 255.0;
                    colorArr[arrayIndex + 2] = originalB_[origIndex] / 255.0;
                } else {
                    const heightValue = heightMapFlat[meshIndex];
                    const L_val = heightValue * 100.0; // L en [0, 100]
                    const a_val = originala ? originala[origIndex] : 0;
                    const b_val = originalb ? originalb[origIndex] : 0;
                    const [r, g, b] = labToRgb(L_val, a_val, b_val);
                    colorArr[arrayIndex] = r;
                    colorArr[arrayIndex + 1] = g;
                    colorArr[arrayIndex + 2] = b;
                }
            }
        }
    } else {
        // Resto de colormaps 
        const colormap = colors255[colormapId];
        for (let j = 0; j < Ny; j++) {
            for (let i = 0; i < Nx; i++) {
                const index = j * Nx + i;
                const arrayIndex = index * 3;
                const heightValue = heightMapFlat[index]; // Valor en [0, 1]

                // Convertir a índice de colormap [0, 255]
                const colorIndex = Math.min(255, Math.max(0, Math.floor(heightValue * 255)));

                // Colorear el vértice
                const color = colormap[colorIndex];
                colorArr[arrayIndex] = color[0];     // R
                colorArr[arrayIndex + 1] = color[1]; // G
                colorArr[arrayIndex + 2] = color[2]; // B
            }
        }
    }
    
    colorAttribute.needsUpdate = true;
}

function createAxes() {
    const materialX = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const materialY = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    const materialZ = new THREE.LineBasicMaterial({ color: 0x0000ff });

    const geometryX = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(5, 0, 0)
    ]);
    const xAxis = new THREE.Line(geometryX, materialX);

    const geometryY = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 2.5, 0)
    ]);
    const yAxis = new THREE.Line(geometryY, materialY);

    const geometryZ = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 5)
    ]);
    const zAxis = new THREE.Line(geometryZ, materialZ);

    return { x: xAxis, y: yAxis, z: zAxis };
}

function toggleWireframe(event) {
    const wireframe = meshGroup?.getObjectByName("wireframe");
    if (wireframe) {
        wireframe.visible = event.target.checked;
    }
}

function toggleMesh(event) {
    const mesh = meshGroup?.getObjectByName("mesh");
    if (mesh) {
        mesh.visible = event.target.checked;
    }
}

function toggleRun(event) {
    runSimulation = event.target.checked;
}

function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function(e) {
        const imgElement = new Image();
        imgElement.onload = () => {
            // Guardar dimensiones ORIGINALES
            originalWidth = imgElement.width;
            originalHeight = imgElement.height;

            const { imageData, LData, aData, bData } = preprocessImageToGrayscale(imgElement, Nx, Ny);
            originalImageData = imageData;

            originalL = LData;
            originala = aData;
            originalb = bData;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d'); 
            canvas.width = originalWidth;  
            canvas.height = originalHeight; 
            ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
            const originalRGB = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const totalPixels = originalWidth * originalHeight;
            originalR = new Float32Array(totalPixels);
            originalG = new Float32Array(totalPixels);
            originalB_ = new Float32Array(totalPixels);
            for (let i = 0; i < totalPixels; i++) {
                originalR[i] = originalRGB.data[i * 4];      
                originalG[i] = originalRGB.data[i * 4 + 1];
                originalB_[i] = originalRGB.data[i * 4 + 2];
            }

            currentImageData = originalImageData;
            initializeSimulation();
        };
        imgElement.src = e.target.result;
    };

    reader.readAsDataURL(file);
}

function handleBoundaryChange(event) {
    if (solver) {
        solver.setBoundaryType(event.target.value);
    }
}

function handlePDEChange(event) {
    if (solver) {
        solver.setPDEType(event.target.value);
    }

    updateEquationDisplay(event.target.value);
}

function handleSchemeChange(event) {
    if (solver) {
        solver.setSchemeType(event.target.value);
    }
}

function handleColormapChange(event) {
    currentColormapId = event.target.value;
    updateVisuals(currentImageData);
}

function setVelocity(event) {
    const value = event.target.value;
    velocityValue.textContent = speedAnimation = value;
}

function setInitialCondition() {
    // Restaurar imagen y solver
    currentImageData = originalImageData;

    if (solver) {
        solver.reset();
    }

    // Eliminar la malla anterior para evitar problemas
    if (meshGroup) {
        scene.remove(meshGroup);
        meshGroup.geometry?.dispose();
        meshGroup.material?.dispose();
        meshGroup = null;
        meshGeometry = null;
        positionAttribute = null;
    }

    initializeSimulation();
}

function updateEquationDisplay(pdeType) {
    const equationSection = document.getElementById('equations-section');
    
    if (pdeType === 'heat') {
        equationSection.innerHTML = `
            <h2>Current PDE</h2>
            <p>
                $$ \\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u $$
            </p>
        `;
    } else if (pdeType === 'exponential-decay') {
        equationSection.innerHTML = `
            <h2>Current PDE</h2>
            <p>
                $$ \\frac{\\partial u}{\\partial t} = -\\lambda u $$
            </p>
        `;
    } else {
        equationSection.innerHTML = `
            <h2>Current PDE</h2>
            <p>
                $$ \\frac{\\partial^2 u}{\\partial t^2} = c^2 \\nabla^2 u $$
            </p>
        `;
    }
    
    // Volver a renderizar MathJax
    MathJax.typesetPromise();
}

function saveImage() {
    // Crear un canvas temporal con el tamaño original de canvas2d
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext('2d');

    
    // Generar los datos de imagen según el colormap actual
    if (currentColormapId === 'constant-color') {
        // Construir ImageData con RGB original
        const imgDataArray = new Uint8ClampedArray(originalWidth * originalHeight * 4);
        for (let i = 0; i < originalWidth * originalHeight; i++) {
            imgDataArray[i * 4] = originalR[i];
            imgDataArray[i * 4 + 1] = originalG[i];
            imgDataArray[i * 4 + 2] = originalB_[i];
            imgDataArray[i * 4 + 3] = 255;
        }
        const originalRGBImageData = new ImageData(imgDataArray, originalWidth, originalHeight);
        tempCtx.putImageData(originalRGBImageData, 0, 0);
    } 
    else if (currentColormapId === 'constant-chrominance') {
        // Obtener heightmap actual
        const heightMapFlat = getHeightMapFromImageData(currentImageData, Nx, Ny);
        
        // Generar imagen Lab a resolución original
        const labImageData = applyOriginalLabColormapToImageFullRes(
            heightMapFlat, 
            originala, 
            originalb, 
            originalWidth, 
            originalHeight,
            Nx,
            Ny
        );
        tempCtx.putImageData(labImageData, 0, 0);
    } 
    else {
        // Para otros colormaps, escalamos la imagen actual a la resolución original
        const coloredImageData = applyColormap(currentImageData, currentColormapId);
        
        // Crear un canvas temporal para el escalado
        const tempCanvas2 = document.createElement('canvas');
        tempCanvas2.width = currentImageData.width;
        tempCanvas2.height = currentImageData.height;
        const tempCtx2 = tempCanvas2.getContext('2d');
        tempCtx2.putImageData(coloredImageData, 0, 0);
        
        // Dibujar escalado al tamaño original
        tempCtx.drawImage(tempCanvas2, 0, 0, originalWidth, originalHeight);
    }   

    let filename = prompt('Enter the file name (without extension):', `image_${tempCanvas.width}x${tempCanvas.height}`);
    if (!filename) return;

    // Generar el data URL del canvas
    const ext = 'png';
    const mimeType = 'image/png';
    tempCanvas.toBlob((blob) => {
        if (!blob) {
            alert('Error generating image.');
            return;
        }

        // Crear enlace temporal para descarga
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, mimeType);
}

// Volver a valores por defecto iniciales de los checkbox al recargar la página
window.addEventListener('load', () => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = cb.defaultChecked;
    });

    wireframeCheck.dispatchEvent(new Event('change'));
    meshCheck.dispatchEvent(new Event('change'));
    runCheck.dispatchEvent(new Event('change'));

    fileUpload.value = '';

    document.getElementById('colormap-select').value = 'viridiscmap';
    document.getElementById('pde-select').value = 'wave';
    document.getElementById('boundary-select').value = 'reflective';
    document.getElementById('scheme-select').value = 'forward-euler';
    document.getElementById('speed-slider').value = 50;
});

window.addEventListener('keydown', (event) => {
const key = event.key.toLowerCase();

  if (key === 'e') {
    toggledE = !toggledE;

    if (toggledE) {
      // Modo pantalla completa 3D
      canvas3dContainer.style.position = 'fixed';
      canvas3dContainer.style.top = '0';
      canvas3dContainer.style.left = '0';
      canvas3dContainer.style.width = '100vw';
      canvas3dContainer.style.height = '100vh';
      canvas3dContainer.style.zIndex = '9999';

      // Ocultar todo lo demás
      document.getElementById('main-container').style.display = 'none';
      document.getElementById('canvas2d-section').style.display = 'none';
    } else {
      // Volver a modo normal
      canvas3dContainer.style.position = '';
      canvas3dContainer.style.top = '';
      canvas3dContainer.style.left = '';
      canvas3dContainer.style.width = '';
      canvas3dContainer.style.height = '';
      canvas3dContainer.style.zIndex = originalZ;

      document.getElementById('main-container').style.display = '';
      document.getElementById('canvas2d-section').style.display = '';
    }

    axes.x.visible = !axes.x.visible;
    axes.y.visible = !axes.y.visible;
    axes.z.visible = !axes.z.visible;
  }

  if (key === 'r') {
    runCheck.click();
  }
  
  if (key === 's') {
    saveImage();
  }
  
    if (key === 'n') {
        normalizeHeights = !normalizeHeights;

        const indicator = document.getElementById('normalization-indicator');
        if (normalizeHeights) {
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    if (key === 'g') {
        const wasUsingGPU = useGPUSolver;
        useGPUSolver = !useGPUSolver;
        
        const isGPUCompatible = (
            ['wave', 'heat'].includes(document.getElementById('pde-select').value) &&
            document.getElementById('scheme-select').value === 'forward-euler' &&
            ['periodic', 'reflective'].includes(document.getElementById('boundary-select').value)
        );
        
        const gpuIndicator = document.getElementById('gpu-solver-indicator');
        gpuIndicator.style.display = isGPUCompatible && useGPUSolver ? 'block' : 'none';
        
        // Solo cambiar si es compatible
        if (isGPUCompatible || !useGPUSolver) {
            solver.setUseGPU(isGPUCompatible && useGPUSolver);
        } else {
            // Revertir cambio si no es compatible
            useGPUSolver = wasUsingGPU;
        }
    }

  if (key === 'ñ') {
    console.log("¡Has descubierto un easter egg! Entre tú y yo: aplica la ecuación de calor con Constant Color, condiciones Zero, y descubrirás el modo 'cojín'");
  }
});

function isWebGL2Supported() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
    } catch (e) {
        return false;
    }
}